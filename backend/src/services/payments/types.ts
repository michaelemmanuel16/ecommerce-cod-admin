import type { Money } from '../../utils/money';

/**
 * The one shape every payment provider is used through (F-400). The app talks to this
 * interface only; a provider's own SDK, HTTP calls and minor-unit maths live in its adapter.
 * Amounts in and out are Decimal major units (GH₵ 249.00). Minor units exist inside an adapter only.
 *
 * Provider credentials are per tenant, so each call that needs them takes the tenantId.
 */

/** success: money taken. abandoned: the buyer left. failed: declined or reversed. pending: not decided yet. */
export type PaymentStatus = 'success' | 'abandoned' | 'failed' | 'pending';

export type PaymentChannel = 'card' | 'mobile_money' | 'bank_transfer' | 'ussd';

export interface InitializeInput {
  /** Major units. */
  amount: Money;
  currency: string;
  customer: { email: string; firstName?: string; lastName?: string; phone?: string };
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface InitializeResult {
  /** Hosted payment page the buyer is sent to. */
  authorizationUrl: string;
  /** The reference the provider will use in verify and in webhooks. */
  providerReference: string;
}

export interface VerifyResult {
  status: PaymentStatus;
  /** What was charged, major units. */
  amount: Money;
  /** The same amount as the provider reported it, in its minor units. Settlement compares this to the stored charge. */
  amountMinor: number;
  currency: string;
  /** Provider fee, major units. */
  fee: Money;
  /** False when the provider gave no fee figure. */
  feeKnown: boolean;
  channel: string | null;
  paidAt: Date | null;
  /** The provider's raw answer, for logs and support. Never shown to the buyer. */
  raw: unknown;
}

export interface ParsedWebhook {
  /** Provider event name as sent, for example `charge.success`. Used in the replay guard. */
  eventType: string;
  eventId: string | null;
  kind: 'payment_succeeded' | 'payment_failed' | 'other';
  reference: string | null;
}

/** Result of testing a stored connection: whether the keys work and which currencies the account holds. */
export interface ConnectionCheck {
  ok: boolean;
  message: string;
  supportedCurrencies: string[];
}

export interface PaymentProvider {
  readonly id: string;
  /** Name shown to the seller, for example `Paystack`. */
  readonly displayName: string;
  /** Channels this provider offers for a currency. */
  supportedMethods(currency: string): PaymentChannel[];
  /** The provider's own rule for major to minor units (the charge sent and stored). */
  toMinor(amount: Money, currency: string): number;
  initialize(tenantId: string, input: InitializeInput): Promise<InitializeResult>;
  verify(tenantId: string, reference: string): Promise<VerifyResult>;
  /** True when the signature on a webhook is valid for this tenant's account. */
  verifyWebhook(tenantId: string, rawBody: string | Buffer, headers: Record<string, unknown>): Promise<boolean>;
  parseWebhook(rawBody: string | Buffer): ParsedWebhook;
  /** The key the browser may see. Empty when none. */
  getPublicKey(tenantId: string): Promise<string>;
  /** Refuses keys that cannot belong to this mode (a live key in test mode). Throws a 400 AppError. Optional. */
  validateCredentials?(mode: string, secretKey: string): void;
  /** Calls the provider with the stored keys. Never throws for a bad key: it reports ok false. */
  testConnection(tenantId: string): Promise<ConnectionCheck>;
  /** Drops cached credentials after a settings change. No tenant id drops all. */
  clearConfigCache(tenantId?: string): void;
}
