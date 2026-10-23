import * as Money from '../../utils/money';
import { paystackService, clearPaystackConfigCache } from '../paystackService';
import type { ParsedWebhook, PaymentChannel, PaymentProvider, PaymentStatus } from './types';

/** Paystack transaction statuses to ours (F-401). */
export function mapPaystackStatus(status: string | undefined): PaymentStatus {
  switch (status) {
    case 'success':
      return 'success';
    case 'abandoned':
      return 'abandoned';
    case 'failed':
    case 'reversed':
      return 'failed';
    default:
      // pending, ongoing, processing, queued, and anything new: not decided yet.
      return 'pending';
  }
}

const header = (headers: Record<string, unknown>, name: string): string | undefined => {
  const value = headers[name];
  return typeof value === 'string' ? value : undefined;
};

/** Paystack takes amounts in the subunit: x100 for every currency we sell in (GHS, NGN). Kept exactly as the checkout always did it. */
export const toMinor = (amount: Money.MoneyInput, _currency: string): number => Money.toMinor(amount);

export const paystackAdapter: PaymentProvider = {
  id: 'paystack',

  toMinor,

  supportedMethods(): PaymentChannel[] {
    // The hosted page offers whatever channels the Paystack account has; no channel list is forced (F-401).
    return ['card', 'mobile_money', 'bank_transfer', 'ussd'];
  },

  async initialize(tenantId, input) {
    const result = await paystackService.initializeTransaction(
      tenantId,
      input.customer.email,
      toMinor(input.amount, input.currency),
      input.currency,
      input.metadata ?? {},
      input.callbackUrl,
      { firstName: input.customer.firstName, lastName: input.customer.lastName, phone: input.customer.phone },
    );
    return { authorizationUrl: result.authorization_url, providerReference: result.reference };
  },

  async verify(tenantId, reference) {
    const { data } = await paystackService.verifyTransaction(tenantId, reference);
    const currency = data.currency;
    const rawFee = data.fees;
    return {
      status: mapPaystackStatus(data.status),
      amount: Money.fromMinor(Money.orZero(data.amount)),
      amountMinor: Money.orZero(data.amount).toNumber(),
      currency,
      fee: Money.fromMinor(Money.orZero(rawFee)),
      feeKnown: rawFee !== undefined && rawFee !== null,
      channel: data.channel ?? null,
      paidAt: data.paid_at ? new Date(data.paid_at) : null,
      raw: data,
    };
  },

  async verifyWebhook(tenantId, rawBody, headers) {
    const signature = header(headers, 'x-paystack-signature');
    if (!signature) return false;
    return paystackService.validateWebhookSignature(tenantId, rawBody, signature);
  },

  parseWebhook(rawBody): ParsedWebhook {
    const event = JSON.parse(rawBody.toString());
    const eventType = typeof event?.event === 'string' ? event.event : '';
    const reference = typeof event?.data?.reference === 'string' ? event.data.reference : null;
    return {
      eventType,
      eventId: event?.data?.id !== undefined ? String(event.data.id) : reference,
      kind: eventType === 'charge.success' ? 'payment_succeeded' : 'other',
      reference,
    };
  },

  fee: (verified) => verified.fee,

  getPublicKey: (tenantId) => paystackService.getPublicKey(tenantId),

  isConfigured: (tenantId) => paystackService.isConfigured(tenantId),

  testConnection: (tenantId) => paystackService.testConnection(tenantId),

  clearConfigCache: (tenantId) => clearPaystackConfigCache(tenantId),
};
