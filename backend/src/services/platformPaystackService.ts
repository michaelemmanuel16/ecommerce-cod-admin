import crypto from 'crypto';
import { AppError } from '../middleware/errorHandler';
import logger from '../utils/logger';

/**
 * Platform Paystack service (MAN-61).
 *
 * The inverse of `paystackService.ts`: that service charges a TENANT's buyers on
 * the tenant's own Paystack keys. This one charges CodAdmin's TENANTS a recurring
 * SaaS subscription on CodAdmin's OWN platform Paystack account, whose secret lives
 * in `PLATFORM_PAYSTACK_SECRET_KEY` (env, never the DB — avoids the NULL-tenant
 * SystemConfig landmine). No tenantId, no per-tenant cache.
 */

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
    amount: number; // minor units (kobo)
    currency: string;
    metadata: Record<string, any>;
    customer: { email: string; customer_code?: string };
    authorization?: {
      authorization_code?: string;
      last4?: string;
    };
    plan?: string;
    plan_object?: { plan_code?: string };
    subscription_code?: string;
    next_payment_date?: string;
  };
}

interface SubscriptionResponse {
  status: boolean;
  data: {
    subscription_code: string;
    email_token: string; // required to disable a subscription
    status: string; // 'active' | 'non-renewing' | 'cancelled' | ...
    next_payment_date?: string;
    customer?: { customer_code?: string; email?: string };
    plan?: { plan_code?: string };
  };
}

/**
 * Cheap env-presence check (CEO review F2). Callers degrade gracefully — render
 * pricing/billing read-only and hide subscribe CTAs — instead of 500ing when the
 * platform keys are unset, rotated, or mid-deploy. Read at call-time so tests and
 * runtime config changes are reflected without a restart.
 */
export function isPlatformBillingConfigured(): boolean {
  return !!process.env.PLATFORM_PAYSTACK_SECRET_KEY;
}

function requireSecret(): string {
  const secret = process.env.PLATFORM_PAYSTACK_SECRET_KEY;
  if (!secret) {
    throw new AppError(
      'Platform billing is not configured. Set PLATFORM_PAYSTACK_SECRET_KEY.',
      503,
      'PLATFORM_PAYSTACK_NOT_CONFIGURED',
    );
  }
  return secret;
}

async function platformRequest(method: string, path: string, body?: object): Promise<any> {
  const secret = requireSecret();

  const url = `https://api.paystack.co${path}`;
  const options: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data: any = await response.json();

  if (!response.ok) {
    logger.error('Platform Paystack API error', { path, status: response.status, message: data?.message });
    throw new Error(data?.message || `Paystack API error: ${response.status}`);
  }

  return data;
}

export const platformPaystackService = {
  isPlatformBillingConfigured,

  /**
   * Initialize a subscription transaction on the platform account. Passing `plan`
   * tells Paystack to auto-create the subscription on the first successful charge,
   * then bill it on the plan's interval. Amount is in minor units (kobo for NGN).
   */
  async initializeSubscriptionTransaction(
    email: string,
    planCode: string,
    amountInMinorUnits: number,
    metadata: Record<string, any>,
    callbackUrl: string,
  ): Promise<InitializeResponse> {
    const result = await platformRequest('POST', '/transaction/initialize', {
      email,
      amount: amountInMinorUnits,
      currency: 'NGN',
      plan: planCode,
      metadata,
      callback_url: callbackUrl,
    });

    logger.info('Platform subscription transaction initialized', {
      reference: result.data.reference,
      email,
      planCode,
      amount: amountInMinorUnits,
    });

    return result.data;
  },

  /**
   * Verify a transaction by reference against the platform account.
   */
  async verifyTransaction(reference: string): Promise<VerifyResponse> {
    return platformRequest('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  },

  /**
   * Fetch a subscription by id or code. Returns `email_token`, which is REQUIRED
   * to disable the subscription, plus its status and next payment date.
   */
  async getSubscription(idOrCode: string): Promise<SubscriptionResponse> {
    return platformRequest('GET', `/subscription/${encodeURIComponent(idOrCode)}`);
  },

  /**
   * Disable (cancel) a subscription. Paystack requires both the subscription code
   * and the email_token obtained from `getSubscription`.
   */
  async disableSubscription(code: string, emailToken: string): Promise<void> {
    await platformRequest('POST', '/subscription/disable', { code, token: emailToken });
    logger.info('Platform subscription disabled', { subscriptionCode: code });
  },

  /**
   * Validate a platform webhook signature (HMAC SHA-512 keyed on the platform
   * secret key). Returns false on any mismatch or when unconfigured.
   */
  validateWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    const secret = process.env.PLATFORM_PAYSTACK_SECRET_KEY;
    if (!secret) {
      logger.warn('Platform Paystack secret key not configured; rejecting webhook');
      return false;
    }

    const hash = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');

    try {
      return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(signature, 'hex'));
    } catch {
      // Length mismatch throws — treat as invalid signature
      return false;
    }
  },
};
