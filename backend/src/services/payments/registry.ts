import { AppError } from '../../middleware/errorHandler';
import { paystackAdapter } from './paystackAdapter';
import type { PaymentProvider } from './types';

/** The provider a form uses when it names none (F-400). */
export const DEFAULT_PAYMENT_PROVIDER = 'paystack';

const providers = new Map<string, PaymentProvider>([[paystackAdapter.id, paystackAdapter]]);

/** Adds a provider, or replaces the one with the same id. Release one ships Paystack only; tests add fakes. */
export function registerPaymentProvider(provider: PaymentProvider): void {
  providers.set(provider.id, provider);
}

/** Removes a provider. For tests that registered a fake. */
export function unregisterPaymentProvider(id: string): void {
  providers.delete(id);
}

export function getPaymentProvider(id: string = DEFAULT_PAYMENT_PROVIDER): PaymentProvider {
  const provider = providers.get(id);
  if (!provider) throw new AppError(`Unknown payment provider: ${id}`, 400, 'UNKNOWN_PAYMENT_PROVIDER');
  return provider;
}

/** Drops cached credentials of every provider for one tenant, after a settings change. */
export function clearPaymentConfigCache(tenantId?: string): void {
  for (const provider of providers.values()) provider.clearConfigCache(tenantId);
}
