import * as Money from '../../utils/money';
import type { ParsedWebhook, PaymentChannel, PaymentProvider, PaymentStatus, VerifyResult } from './types';

/**
 * In-memory provider for tests (F-400): it proves the controllers and the settlement code
 * work against the interface alone. Not registered by default; a test calls
 * `registerPaymentProvider(createFakeProvider())`.
 *
 * Webhook signature: the header `x-fake-signature` must equal 'valid'.
 * A payment starts `pending`; `setPayment(reference, ...)` decides its outcome.
 */
export interface FakePayment {
  status: PaymentStatus;
  amount: Money.MoneyInput;
  currency?: string;
  fee?: Money.MoneyInput;
  channel?: string;
}

export interface FakeProvider extends PaymentProvider {
  setPayment(reference: string, payment: FakePayment): void;
  readonly initialized: Array<{ tenantId: string; reference: string; amount: string; currency: string }>;
}

export function createFakeProvider(id = 'fake'): FakeProvider {
  const payments = new Map<string, FakePayment>();
  const initialized: FakeProvider['initialized'] = [];
  let seq = 0;

  return {
    id,
    displayName: id,
    initialized,

    setPayment(reference, payment) {
      payments.set(reference, payment);
    },

    toMinor: (amount, _currency) => Money.toMinor(amount),

    supportedMethods(): PaymentChannel[] {
      return ['card'];
    },

    async initialize(tenantId, input) {
      const reference = `${id}_ref_${++seq}`;
      initialized.push({ tenantId, reference, amount: Money.toApi(input.amount), currency: input.currency });
      return { authorizationUrl: `https://pay.${id}.test/${reference}`, providerReference: reference };
    },

    async verify(_tenantId, reference): Promise<VerifyResult> {
      const p = payments.get(reference) ?? { status: 'pending' as const, amount: 0 };
      return {
        status: p.status,
        amount: Money.parse(p.amount),
        amountMinor: Money.toMinor(p.amount),
        currency: p.currency ?? 'GHS',
        fee: Money.orZero(p.fee),
        feeKnown: p.fee !== undefined,
        channel: p.channel ?? null,
        paidAt: p.status === 'success' ? new Date() : null,
        raw: p,
      };
    },

    async verifyWebhook(_tenantId, _rawBody, headers) {
      return headers['x-fake-signature'] === 'valid';
    },

    parseWebhook(rawBody): ParsedWebhook {
      const event = JSON.parse(rawBody.toString());
      return {
        eventType: event.type,
        eventId: event.id ?? null,
        kind: event.type === 'payment.success' ? 'payment_succeeded' : event.type === 'payment.failed' ? 'payment_failed' : 'other',
        reference: event.reference ?? null,
      };
    },

    fee: (verified) => verified.fee,

    async getPublicKey() {
      return `pk_${id}_public`;
    },

    async isConfigured() {
      return true;
    },

    async testConnection() {
      return { ok: true, message: 'Fake keys accepted', supportedCurrencies: ['GHS', 'NGN'] };
    },

    clearConfigCache() {},
  };
}
