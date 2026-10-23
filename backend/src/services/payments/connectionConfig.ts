import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';
import { decryptProviderSecrets, decryptString } from '../../utils/providerCrypto';

/** A tenant's keys for one provider, secret decrypted. Server side only; never send this to a client. */
export interface ProviderConfig {
  publicKey: string;
  secretKey: string;
  mode: 'test' | 'live';
  isEnabled: boolean;
  supportedCurrencies: string[];
  /** `connection`: a PaymentConnection row. `legacy`: the SystemConfig.paystackProvider JSON, read until the copy script has moved it. */
  source: 'connection' | 'legacy';
}

/**
 * The tenant's keys for a provider. A PaymentConnection row wins. Without one, a Paystack tenant falls back
 * to the old SystemConfig.paystackProvider JSON, so tenants that never re-saved their keys keep paying (F-400).
 * Returns null when no usable secret exists.
 */
export async function loadProviderConfig(tenantId: string, provider: string): Promise<ProviderConfig | null> {
  const row = await prisma.paymentConnection.findFirst({ where: { tenantId, provider } });
  if (row) {
    if (!row.secretKey) return null;
    return {
      publicKey: row.publicKey ?? '',
      secretKey: decryptString(row.secretKey) as string,
      mode: row.mode === 'live' ? 'live' : 'test',
      isEnabled: row.isEnabled,
      supportedCurrencies: row.supportedCurrencies,
      source: 'connection',
    };
  }

  if (provider !== 'paystack') return null;
  const legacy = await prisma.systemConfig.findUnique({ where: { tenantId }, select: { paystackProvider: true } });
  const json = legacy?.paystackProvider as Record<string, unknown> | null | undefined;
  const decrypted = json ? decryptProviderSecrets('paystackProvider', json) : null;
  if (!decrypted?.secretKey) return null;
  return {
    publicKey: decrypted.publicKey || '',
    secretKey: decrypted.secretKey,
    mode: decrypted.mode === 'live' ? 'live' : 'test',
    isEnabled: decrypted.isEnabled !== false,
    supportedCurrencies: [],
    source: 'legacy',
  };
}

/** The secret key of a Paystack account tells its mode: sk_live_ or sk_test_. Other providers have no rule yet. */
export function assertKeyMatchesMode(provider: string, mode: string | undefined, secretKey: string | undefined | null): void {
  if (provider !== 'paystack' || !secretKey) return;
  if (mode === 'live' && !secretKey.startsWith('sk_live_')) {
    throw new AppError(
      'Paystack mode is set to Live but the secret key is not a live key (sk_live_...). Match the mode to the key.',
      400,
      'PAYSTACK_MODE_KEY_MISMATCH',
    );
  }
  if (mode === 'test' && !secretKey.startsWith('sk_test_')) {
    throw new AppError(
      'Paystack mode is set to Test but the secret key is not a test key (sk_test_...). Match the mode to the key.',
      400,
      'PAYSTACK_MODE_KEY_MISMATCH',
    );
  }
}

/**
 * F-401: the message when a form turns online payment on for a currency the account cannot take, else null.
 * An account never tested has no currency list and is not blocked.
 */
export function unsupportedCurrencyMessage(config: Pick<ProviderConfig, 'supportedCurrencies'> | null, currency: string): string | null {
  if (!config || config.supportedCurrencies.length === 0) return null;
  const code = currency.toUpperCase();
  if (config.supportedCurrencies.includes(code)) return null;
  return `This payment account cannot take ${code}. Connect another account or provider.`;
}
