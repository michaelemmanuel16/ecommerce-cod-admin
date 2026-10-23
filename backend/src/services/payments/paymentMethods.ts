/**
 * Payment method names and the method matrix (F-400, F-402).
 *
 * New rows store `online_full` / `online_deposit` (the provider goes in Order.paymentProvider).
 * The old names `paystack`, `paystack_full`, `paystack_deposit` are still read and accepted on the public API
 * until 2027-01-21 (90 days after the neutral names shipped on 2026-10-23). After that date delete LEGACY_METHOD_NAMES and its use in normalizeMethod.
 */

export type PaymentMethodName = 'cod' | 'online_deposit' | 'online_full';

const LEGACY_METHOD_NAMES: Record<string, PaymentMethodName> = {
  paystack: 'online_full',
  paystack_full: 'online_full',
  paystack_deposit: 'online_deposit',
};

/** A method name from a request or a stored row as the neutral name, or null when it is none we know. */
export function normalizeMethod(name: unknown): PaymentMethodName | null {
  if (name === 'cod' || name === 'online_full' || name === 'online_deposit') return name;
  return typeof name === 'string' ? LEGACY_METHOD_NAMES[name] ?? null : null;
}

export const isOnlineMethod = (m: PaymentMethodName): boolean => m !== 'cod';

export type MethodMatrix = Record<PaymentMethodName, boolean>;

/**
 * Which methods a form may offer, by form type and the tenant flag `features.prepaidPhysical`:
 * physical forms take COD only while the flag is off; with it on they may also take the online methods;
 * digital forms take online payment in full only, whatever the flag says.
 */
export function methodMatrix(formType: 'physical' | 'digital', prepaidPhysical: boolean): MethodMatrix {
  if (formType === 'digital') return { cod: false, online_deposit: false, online_full: true };
  return { cod: true, online_deposit: prepaidPhysical, online_full: prepaidPhysical };
}
