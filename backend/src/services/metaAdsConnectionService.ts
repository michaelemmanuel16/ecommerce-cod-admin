import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { resolveTenantId } from '../utils/tenantContext';
import { createOAuthState, peekOAuthState, consumeOAuthState } from '../utils/oauthState';
import { encryptString, decryptString } from '../utils/providerCrypto';
import {
  ADS_GRAPH_API_BASE,
  generateAdsAuthUrl,
  getAdsRedirectUri,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  debugToken,
  fetchAdAccounts,
} from './metaOAuthService';
import { safeErrorMessage } from '../utils/safeError';

interface AdsStatePayload { kind: 'ads'; userId: number; tenantId: string }
interface PickPayload {
  kind: 'pick';
  userId: number;
  tenantId: string;
  /** encrypted (enc:v1:) */
  token: string;
  tokenType: 'system_user' | 'user';
  tokenExpiresAt: string | null;
  scopes: string[];
}

export class MetaAdsError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const settingsUrl = () =>
  `${process.env.FRONTEND_URL || 'http://localhost:5173'}/settings?tab=integrations&section=meta-ads`;
const errorUrl = (message: string) => `${settingsUrl()}&metaAds=error&message=${encodeURIComponent(message)}`;

export function initiateAdsOAuth(userId: number, tenantId: string): string {
  const state = createOAuthState({ kind: 'ads', userId, tenantId } satisfies AdsStatePayload);
  return generateAdsAuthUrl(getAdsRedirectUri(), state);
}

/** Handles Meta's redirect. Returns the frontend URL to redirect to. Never puts a token in it. */
export async function completeAdsCallback(query: Record<string, string | undefined>): Promise<string> {
  const { code, state, error, error_description } = query;
  if (error) {
    return errorUrl((error_description || error).substring(0, 200));
  }
  if (!code || !state) return errorUrl('Missing code or state');

  const stored = consumeOAuthState<AdsStatePayload>(state);
  if (!stored || stored.kind !== 'ads') return errorUrl('Invalid or expired state. Please try again.');

  try {
    const redirectUri = getAdsRedirectUri();
    let { accessToken: token } = await exchangeCodeForToken(code, redirectUri, ADS_GRAPH_API_BASE);
    // Facebook Login for Business gives a system user token (no expiry); a plain user token is swapped for a ~60-day one
    if (!process.env.META_ADS_CONFIG_ID) {
      ({ accessToken: token } = await exchangeForLongLivedToken(token, ADS_GRAPH_API_BASE));
    }

    const info = await debugToken(token);
    if (!info.isValid) return errorUrl('Meta did not return a valid token. Please try again.');
    if (!info.scopes.includes('ads_read')) {
      return errorUrl(`Missing permission: ads_read. Meta gave: ${info.scopes.join(', ') || 'none'}. Allow ads access and try again.`);
    }

    const pickId = createOAuthState({
      kind: 'pick',
      userId: stored.userId,
      tenantId: stored.tenantId,
      token: encryptString(token) as string,
      tokenType: info.type === 'SYSTEM_USER' ? 'system_user' : 'user',
      tokenExpiresAt: info.expiresAt ? info.expiresAt.toISOString() : null,
      scopes: info.scopes,
    } satisfies PickPayload);
    return `${settingsUrl()}&metaAds=pick&pick=${pickId}`;
  } catch (err: any) {
    logger.error('Meta Ads OAuth callback failed', { error: safeErrorMessage(err) });
    return errorUrl('Meta Ads connection failed. Please try again.');
  }
}

function getPick(pickId: string, userId: number, consume = false): PickPayload {
  const pick = peekOAuthState<PickPayload>(pickId);
  if (!pick || pick.kind !== 'pick' || pick.userId !== userId || pick.tenantId !== resolveTenantId()) {
    throw new MetaAdsError(404, 'No pending Meta Ads session. Please connect again.');
  }
  if (consume) consumeOAuthState(pickId);
  return pick;
}

export async function listPickAccounts(pickId: string, userId: number) {
  const pick = getPick(pickId, userId);
  const accounts = await fetchAdAccounts(decryptString(pick.token) as string);
  const connected = await prisma.metaAdAccount.findMany({
    where: { accountId: { in: accounts.map((a) => a.accountId) } },
    select: { accountId: true },
  });
  const connectedIds = new Set(connected.map((c) => c.accountId));
  return accounts.map((a) => ({
    id: a.accountId,
    name: a.name,
    currency: a.currency,
    timezone: a.timezone,
    alreadyConnected: connectedIds.has(a.accountId),
  }));
}

/** Save the chosen accounts. An account that is already connected gets the new token (this is Reconnect). */
export async function savePick(pickId: string, userId: number, accountIds: string[]) {
  const pick = getPick(pickId, userId);
  const wanted = accountIds.map((id) => id.replace(/^act_/, ''));
  const available = await fetchAdAccounts(decryptString(pick.token) as string);
  const chosen = wanted.map((id) => available.find((a) => a.accountId === id));
  if (chosen.some((a) => !a)) throw new MetaAdsError(400, 'An ad account is not available to this Meta login');

  const tenantId = resolveTenantId();
  for (const a of chosen as typeof available) {
    const fields = {
      name: a.name,
      currency: a.currency,
      timezone: a.timezone,
      status: 'connected' as const,
      statusReason: null,
      accessToken: pick.token,
      tokenType: pick.tokenType,
      tokenExpiresAt: pick.tokenExpiresAt ? new Date(pick.tokenExpiresAt) : null,
      scopes: pick.scopes,
      connectedById: userId,
      failedPullCount: 0,
      lastPullError: null,
    };
    await prisma.metaAdAccount.upsert({
      where: { tenantId_accountId: { tenantId, accountId: a.accountId } },
      create: { tenantId, accountId: a.accountId, ...fields },
      update: fields,
    });
  }
  consumeOAuthState(pickId);
  return { connected: chosen.length };
}

export function listAccounts() {
  return prisma.metaAdAccount.findMany({
    orderBy: { id: 'asc' },
    select: {
      id: true, accountId: true, name: true, currency: true, timezone: true, enabled: true,
      status: true, statusReason: true, tokenType: true, tokenExpiresAt: true, lastPulledAt: true, lastPullError: true,
    },
  });
}

async function findAccount(id: number) {
  const row = await prisma.metaAdAccount.findFirst({ where: { id } });
  if (!row) throw new MetaAdsError(404, 'Ad account not found');
  return row;
}

export async function setEnabled(id: number, enabled: boolean) {
  await findAccount(id);
  await prisma.metaAdAccount.update({ where: { id }, data: { enabled } });
  return { id, enabled };
}

export async function deleteAccount(id: number) {
  await findAccount(id);
  await prisma.metaAdAccount.delete({ where: { id } });

  // No revoke at Meta: DELETE /me/permissions drops the user's whole grant to the app, WhatsApp included.
  return { success: true };
}
