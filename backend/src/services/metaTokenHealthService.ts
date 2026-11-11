import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { debugToken } from './metaOAuthService';
import { decryptString } from '../utils/providerCrypto';
import { createNotification, findTenantAdmins } from './notificationService';
import { safeErrorMessage } from '../utils/safeError';

const WARN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const REVOKED_REASON = 'Meta access was removed. Reconnect Meta Ads.';
const EXPIRED_REASON = 'Meta access expired. Reconnect Meta Ads.';
const MISSING_SCOPE_REASON = 'Missing permission: ads_read';

type Health = { status: 'connected' | 'disconnected'; reason: string | null };
type Row = { id: number; name: string; status: string; statusReason: string | null };

const formatDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Set the health of some rows of the current tenant. Rows already in that state are left alone.
 * A change to Disconnected or to the 7-day warning alerts the owner and admins once (one message for the batch).
 */
async function applyHealth(rows: Row[], next: Health, alert: boolean): Promise<void> {
  const changed = rows.filter((r) => r.status !== next.status || r.statusReason !== next.reason);
  if (changed.length === 0) return;

  await prisma.metaAdAccount.updateMany({
    where: { id: { in: changed.map((r) => r.id) } },
    data: { status: next.status, statusReason: next.reason },
  });

  if (!alert || !next.reason) return;
  try {
    const names = changed.map((r) => r.name).join(', ');
    const title = next.status === 'disconnected' ? 'Meta Ads disconnected' : 'Meta Ads token expires soon';
    for (const admin of await findTenantAdmins()) {
      await createNotification(String(admin.id), 'meta_ads_token', title, `${next.reason} (${names})`, {
        adAccountIds: changed.map((r) => r.id),
      });
    }
  } catch (err: any) {
    logger.error('Meta Ads token alert failed', { error: safeErrorMessage(err) });
  }
}

/**
 * Check every distinct Meta Ads token of the current tenant with debug_token and set each row's status.
 * Run it inside a tenant context. A failed check (network, Meta outage) changes nothing for that token.
 */
export async function checkAdsTokens(): Promise<void> {
  const rows = await prisma.metaAdAccount.findMany({
    select: { id: true, name: true, status: true, statusReason: true, accessToken: true, tokenType: true },
  });

  const byToken = new Map<string, typeof rows>();
  for (const row of rows) {
    const token = decryptString(row.accessToken);
    if (!token) continue;
    byToken.set(token, [...(byToken.get(token) || []), row]);
  }

  for (const [token, group] of byToken) {
    let info;
    try {
      info = await debugToken(token);
    } catch (err: any) {
      logger.warn('Meta Ads token check failed', { error: safeErrorMessage(err) });
      continue;
    }

    const now = Date.now();
    let next: Health = { status: 'connected', reason: null };
    let alert = true;
    if (!info.isValid) {
      next = { status: 'disconnected', reason: REVOKED_REASON };
    } else if (info.expiresAt && info.expiresAt.getTime() <= now) {
      next = { status: 'disconnected', reason: EXPIRED_REASON };
    } else if (!info.scopes.includes('ads_read')) {
      next = { status: 'disconnected', reason: MISSING_SCOPE_REASON };
    } else if (info.type !== 'SYSTEM_USER' && info.expiresAt && info.expiresAt.getTime() - now < WARN_DAYS * DAY_MS) {
      next = { status: 'connected', reason: `Expires on ${formatDate(info.expiresAt)}. Reconnect Meta Ads.` };
    } else {
      alert = false;
    }
    await applyHealth(group, next, alert);
  }
}

/**
 * Call this when a Meta Ads call fails. Error 190 (invalid token) marks the account Disconnected and alerts.
 * Returns true when the error was a token error. Run it inside the tenant context.
 */
export async function metaAdsApiError(adAccountId: number, err: unknown): Promise<boolean> {
  const e = err as any;
  const code = e?.code ?? e?.error?.code ?? e?.response?.error?.code;
  if (code !== 190) return false;
  const row = await prisma.metaAdAccount.findFirst({
    where: { id: adAccountId },
    select: { id: true, name: true, status: true, statusReason: true },
  });
  if (row) await applyHealth([row], { status: 'disconnected', reason: REVOKED_REASON }, true);
  return true;
}
