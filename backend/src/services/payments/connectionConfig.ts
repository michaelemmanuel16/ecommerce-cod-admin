import prisma from '../../utils/prisma';
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
