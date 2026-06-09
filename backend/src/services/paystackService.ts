import crypto from 'crypto';
import prisma from '../utils/prisma';
import { decryptProviderSecrets } from '../utils/providerCrypto';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';

interface PaystackConfig {
  publicKey: string;
  secretKey: string;
  mode: 'test' | 'live';
  isEnabled: boolean;
}

interface InitializeResponse {
  authorization_url: string;
  access_code: string;
  reference: string;
}

interface VerifyResponse {
  status: boolean;
  data: {
    status: string; // 'success' | 'failed' | 'abandoned'
    reference: string;
    amount: number; // in kobo/pesewas
    currency: string;
    fees: number;
    metadata: Record<string, any>;
    customer: { email: string };
  };
}

// ---------- Per-tenant config cache ----------

const CACHE_TTL_MS = 60_000;
const configCache: Map<string, { data: PaystackConfig | null; fetchedAt: number }> = new Map();

async function loadTenantPaystackConfig(tenantId: string): Promise<PaystackConfig | null> {
  const cached = configCache.get(tenantId);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const config = await prisma.systemConfig.findUnique({
      where: { tenantId },
      select: { paystackProvider: true },
    });
    const provider = config?.paystackProvider as any;
    const decrypted = provider ? decryptProviderSecrets('paystackProvider', provider) : null;

    let result: PaystackConfig | null = null;
    if (decrypted && decrypted.secretKey) {
      result = {
        publicKey: decrypted.publicKey || '',
        secretKey: decrypted.secretKey,
        mode: decrypted.mode === 'live' ? 'live' : 'test',
        isEnabled: decrypted.isEnabled !== false,
      };
    }

    configCache.set(tenantId, { data: result, fetchedAt: now });
    return result;
  } catch (error: any) {
    logger.warn('Failed to read tenant Paystack config', { tenantId, error: error.message });
    return null;
  }
}

export function clearPaystackConfigCache(tenantId?: string): void {
  if (tenantId) {
    configCache.delete(tenantId);
  } else {
    configCache.clear();
  }
}

async function requireConfig(tenantId: string): Promise<PaystackConfig> {
  const config = await loadTenantPaystackConfig(tenantId);
  if (!config || !config.secretKey) {
    throw new AppError(
      'Paystack is not configured for this tenant. Add your keys in Settings → Integrations.',
      400,
      'PAYSTACK_NOT_CONFIGURED',
    );
  }
  if (!config.isEnabled) {
    throw new AppError(
      'Paystack is disabled for this tenant. Enable it in Settings → Integrations.',
      400,
      'PAYSTACK_DISABLED',
    );
  }
  return config;
}

// ---------- API calls ----------

async function paystackRequest(tenantId: string, method: string, path: string, body?: object): Promise<any> {
  const config = await requireConfig(tenantId);

  const url = `https://api.paystack.co${path}`;
  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data: any = await response.json();

  if (!response.ok) {
    logger.error('Paystack API error', { tenantId, path, status: response.status, data });
    throw new Error(data.message || `Paystack API error: ${response.status}`);
  }

  return data;
}

// ---------- Public API ----------

export const paystackService = {
  /**
   * Initialize a transaction against the tenant's Paystack account.
   * Amount is in the smallest currency unit (pesewas for GHS, kobo for NGN).
   */
  async initializeTransaction(
    tenantId: string,
    email: string,
    amountInMinorUnits: number,
    currency: string,
    metadata: Record<string, any>,
    callbackUrl?: string,
    customer?: { firstName?: string; lastName?: string; phone?: string },
  ): Promise<InitializeResponse> {
    // The receipt/dashboard shows the payer's NAME only when the Paystack
    // Customer behind this email has one — `/transaction/initialize` ignores
    // first_name/last_name. So upsert the customer first (Paystack keys customers
    // by email; a repeat email returns the existing record). Best-effort: a
    // customer-API hiccup must never block the actual payment.
    if (customer && (customer.firstName || customer.lastName || customer.phone)) {
      try {
        await paystackRequest(tenantId, 'POST', '/customer', {
          email,
          ...(customer.firstName ? { first_name: customer.firstName } : {}),
          ...(customer.lastName ? { last_name: customer.lastName } : {}),
          ...(customer.phone ? { phone: customer.phone } : {}),
        });
      } catch (err) {
        logger.warn('Paystack customer upsert failed; receipt may show email only', {
          tenantId,
          error: (err as Error)?.message,
        });
      }
    }

    const result = await paystackRequest(tenantId, 'POST', '/transaction/initialize', {
      email,
      amount: amountInMinorUnits,
      currency: currency.toUpperCase(),
      metadata,
      callback_url: callbackUrl,
    });

    logger.info('Paystack transaction initialized', {
      tenantId,
      reference: result.data.reference,
      email,
      amount: amountInMinorUnits,
      currency,
    });

    return result.data;
  },

  /**
   * Verify a transaction by reference against the tenant's Paystack account.
   */
  async verifyTransaction(tenantId: string, reference: string): Promise<VerifyResponse> {
    const result = await paystackRequest(tenantId, 'GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    return result;
  },

  /**
   * Validate a webhook signature (HMAC SHA-512) using the tenant's webhook secret.
   */
  async validateWebhookSignature(tenantId: string, rawBody: string | Buffer, signature: string): Promise<boolean> {
    const config = await loadTenantPaystackConfig(tenantId);
    // Paystack signs webhooks with HMAC-SHA512 keyed on the account's SECRET KEY
    // (there is no separate "webhook secret"). See Paystack's verify-webhook docs.
    if (!config?.secretKey) {
      logger.warn('Paystack secret key not configured for tenant', { tenantId });
      return false;
    }

    const hash = crypto
      .createHmac('sha512', config.secretKey)
      .update(rawBody)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
      // Length mismatch throws — treat as invalid signature
      return false;
    }
  },

  /**
   * Get a tenant's Paystack public key for the embed widget / inline popup.
   */
  async getPublicKey(tenantId: string): Promise<string> {
    const config = await loadTenantPaystackConfig(tenantId);
    return config?.publicKey ?? '';
  },

  /**
   * Whether the tenant has configured + enabled Paystack.
   */
  async isConfigured(tenantId: string): Promise<boolean> {
    const config = await loadTenantPaystackConfig(tenantId);
    return !!(config && config.isEnabled && config.secretKey);
  },
};
