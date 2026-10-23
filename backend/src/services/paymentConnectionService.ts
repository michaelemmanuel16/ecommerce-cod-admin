import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { getTenantId } from '../utils/tenantContext';
import { encryptString, decryptString, SECRET_MASK } from '../utils/providerCrypto';
import { getPaymentProvider, clearPaymentConfigCache } from './payments';
import { assertKeyMatchesMode, loadProviderConfig } from './payments/connectionConfig';

/**
 * Per-tenant payment provider accounts (F-400, F-401). The secret key is stored encrypted (`enc:v1:`) and
 * is never returned: reads carry the mask sentinel and a `hasSecret` flag. Runs inside the request's tenant context.
 */

export interface ConnectionView {
  /** Null for the old SystemConfig.paystackProvider settings that have not been copied to a row yet. */
  id: number | null;
  provider: string;
  mode: 'test' | 'live';
  publicKey: string | null;
  secretKey: typeof SECRET_MASK | null;
  hasSecret: boolean;
  isEnabled: boolean;
  supportedCurrencies: string[];
  lastCheckedAt: Date | null;
  legacy: boolean;
}

export interface SaveConnectionInput {
  provider: string;
  mode: 'test' | 'live';
  publicKey?: string | null;
  /** Omit, or send the mask, to keep the stored secret. */
  secretKey?: string | null;
  isEnabled?: boolean;
}

type Row = NonNullable<Awaited<ReturnType<typeof prisma.paymentConnection.findFirst>>>;

const requireTenantId = (): string => {
  const tenantId = getTenantId();
  if (!tenantId) throw new AppError('A store is required', 400, 'TENANT_REQUIRED');
  return tenantId;
};

const toView = (row: Row): ConnectionView => ({
  id: row.id,
  provider: row.provider,
  mode: row.mode === 'live' ? 'live' : 'test',
  publicKey: row.publicKey,
  secretKey: row.secretKey ? SECRET_MASK : null,
  hasSecret: !!row.secretKey,
  isEnabled: row.isEnabled,
  supportedCurrencies: row.supportedCurrencies,
  lastCheckedAt: row.lastCheckedAt,
  legacy: false,
});

/** Paystack keys that are still only in SystemConfig.paystackProvider, shown until the copy script (or a first save) moves them. */
async function legacyView(tenantId: string): Promise<ConnectionView | null> {
  const config = await loadProviderConfig(tenantId, 'paystack');
  if (!config || config.source !== 'legacy') return null;
  return {
    id: null,
    provider: 'paystack',
    mode: config.mode,
    publicKey: config.publicKey || null,
    secretKey: SECRET_MASK,
    hasSecret: true,
    isEnabled: config.isEnabled,
    supportedCurrencies: [],
    lastCheckedAt: null,
    legacy: true,
  };
}

export async function listConnections(): Promise<ConnectionView[]> {
  const tenantId = requireTenantId();
  const rows = await prisma.paymentConnection.findMany({ orderBy: { id: 'asc' } });
  const views = rows.map(toView);
  if (!rows.some((r) => r.provider === 'paystack')) {
    const legacy = await legacyView(tenantId);
    if (legacy) views.push(legacy);
  }
  return views;
}

export async function saveConnection(input: SaveConnectionInput): Promise<ConnectionView> {
  const tenantId = requireTenantId();
  const provider = getPaymentProvider(input.provider); // unknown provider: 400

  const existing = await prisma.paymentConnection.findFirst({ where: { provider: provider.id } });
  const sent = typeof input.secretKey === 'string' ? input.secretKey.trim() : '';
  const newSecret = sent && sent !== SECRET_MASK ? sent : null;

  // The secret that ends up stored: the new one, the row's, or (first save of an old tenant) the one in the old JSON.
  let storedSecret: string | null = existing?.secretKey ?? null;
  if (!existing && !newSecret) {
    const legacy = await prisma.systemConfig.findUnique({ where: { tenantId }, select: { paystackProvider: true } });
    const legacySecret = (legacy?.paystackProvider as { secretKey?: string } | null)?.secretKey;
    if (provider.id === 'paystack' && legacySecret) storedSecret = encryptString(legacySecret) as string;
  }
  if (newSecret) storedSecret = encryptString(newSecret) as string;

  // The mode must match the key: a live key in test mode (or the reverse) is refused.
  assertKeyMatchesMode(provider.id, input.mode, newSecret ?? (storedSecret ? (decryptString(storedSecret) as string) : null));

  const data = {
    mode: input.mode,
    publicKey: input.publicKey === undefined ? existing?.publicKey ?? null : input.publicKey || null,
    secretKey: storedSecret,
    isEnabled: input.isEnabled ?? existing?.isEnabled ?? true,
    // New keys may belong to another account: the old currency list is no longer known.
    ...(newSecret ? { supportedCurrencies: [], lastCheckedAt: null } : {}),
  };

  const row = existing
    ? await prisma.paymentConnection.update({ where: { id: existing.id }, data })
    : await prisma.paymentConnection.create({ data: { provider: provider.id, ...data } as never });

  clearPaymentConfigCache(tenantId);
  return toView(row);
}

export async function testConnection(id: number): Promise<{ connection: ConnectionView; ok: boolean; message: string }> {
  const tenantId = requireTenantId();
  const row = await prisma.paymentConnection.findFirst({ where: { id } });
  if (!row) throw new AppError('Payment connection not found', 404, 'NOT_FOUND');

  clearPaymentConfigCache(tenantId); // test the keys as saved, not a cached copy
  const check = await getPaymentProvider(row.provider).testConnection(tenantId);

  const updated = await prisma.paymentConnection.update({
    where: { id: row.id },
    data: { lastCheckedAt: new Date(), ...(check.ok ? { supportedCurrencies: check.supportedCurrencies } : {}) },
  });
  return { connection: toView(updated), ok: check.ok, message: check.message };
}
