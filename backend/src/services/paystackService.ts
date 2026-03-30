import crypto from 'crypto';
import prisma from '../utils/prisma';
import { decryptProviderSecrets } from '../utils/providerCrypto';
import logger from '../utils/logger';

interface PaystackConfig {
  publicKey: string;
  secretKey: string;
  webhookSecret: string;
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

// ---------- Config cache ----------

let cachedConfig: { data: PaystackConfig | null; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

async function getDbPaystackConfig(): Promise<PaystackConfig | null> {
  const now = Date.now();
  if (cachedConfig && now - cachedConfig.fetchedAt < CACHE_TTL_MS) {
    return cachedConfig.data;
  }

  try {
    const config = await prisma.systemConfig.findFirst({
      select: { paystackProvider: true },
    });
    const provider = config?.paystackProvider as any;
    const decrypted = provider ? decryptProviderSecrets('paystackProvider', provider) : null;

    let result: PaystackConfig | null = null;
    if (decrypted && decrypted.secretKey) {
      result = {
        publicKey: decrypted.publicKey || '',
        secretKey: decrypted.secretKey,
        webhookSecret: decrypted.webhookSecret || '',
        isEnabled: decrypted.isEnabled !== false,
      };
    }

    cachedConfig = { data: result, fetchedAt: now };
    return result;
  } catch (error: any) {
    logger.warn('Failed to read Paystack config from DB', { error: error.message });
    return null;
  }
}

export function clearPaystackConfigCache(): void {
  cachedConfig = null;
}

async function getConfig(): Promise<PaystackConfig> {
  const dbConfig = await getDbPaystackConfig();
  if (dbConfig) return dbConfig;

  // Fallback to env vars
  return {
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
    secretKey: process.env.PAYSTACK_SECRET_KEY || '',
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET || '',
    isEnabled: !!process.env.PAYSTACK_SECRET_KEY,
  };
}

// ---------- API calls ----------

async function paystackRequest(method: string, path: string, body?: object): Promise<any> {
  const config = await getConfig();
  if (!config.secretKey) {
    throw new Error('Paystack is not configured. Please add your Paystack keys in Settings → Integrations.');
  }

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
    logger.error('Paystack API error', { path, status: response.status, data });
    throw new Error(data.message || `Paystack API error: ${response.status}`);
  }

  return data;
}

// ---------- Public API ----------

export const paystackService = {
  /**
   * Initialize a transaction — returns the Paystack checkout URL.
   * Amount is in the smallest currency unit (pesewas for GHS, kobo for NGN).
   */
  async initializeTransaction(
    email: string,
    amountInMinorUnits: number,
    currency: string,
    metadata: Record<string, any>,
    callbackUrl?: string,
  ): Promise<InitializeResponse> {
    const result = await paystackRequest('POST', '/transaction/initialize', {
      email,
      amount: amountInMinorUnits,
      currency: currency.toUpperCase(),
      metadata,
      callback_url: callbackUrl,
    });

    logger.info('Paystack transaction initialized', {
      reference: result.data.reference,
      email,
      amount: amountInMinorUnits,
      currency,
    });

    return result.data;
  },

  /**
   * Verify a transaction by reference.
   */
  async verifyTransaction(reference: string): Promise<VerifyResponse> {
    const result = await paystackRequest('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    return result;
  },

  /**
   * Validate a webhook signature (HMAC SHA-512).
   */
  async validateWebhookSignature(rawBody: string | Buffer, signature: string): Promise<boolean> {
    const config = await getConfig();
    if (!config.webhookSecret) {
      logger.warn('Paystack webhook secret not configured');
      return false;
    }

    const hash = crypto
      .createHmac('sha512', config.webhookSecret)
      .update(rawBody)
      .digest('hex');

    return hash === signature;
  },

  /**
   * Get public key for frontend.
   */
  async getPublicKey(): Promise<string> {
    const config = await getConfig();
    return config.publicKey;
  },

  /**
   * Check if Paystack is configured and enabled.
   */
  async isConfigured(): Promise<boolean> {
    const config = await getConfig();
    return config.isEnabled && !!config.secretKey;
  },
};
