import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import * as Money from '../../utils/money';
import { decryptString } from '../../utils/providerCrypto';
import { ADS_GRAPH_API_BASE } from '../metaOAuthService';
import { metaAdsApiError } from '../metaTokenHealthService';
import { createNotification, findTenantAdmins } from '../notificationService';
import { localDate, shiftYmd, utcDateOfYmd } from '../kpi/dates';
import { safeErrorMessage } from '../../utils/safeError';

/**
 * M8-T05 (COD-71): pull campaign-level daily insights from Meta and keep them in MetaSpendDay.
 * The token is sent in a header. It is never logged, returned, or put in an error message.
 */

export interface InsightRow {
  campaignId: string;
  campaignName: string;
  campaignStatus: string | null;
  /** Day in the ad account's time zone, YYYY-MM-DD */
  date: string;
  currency: string;
  /** Decimal string, 4 places */
  spend: string;
  impressions: number;
  linkClicks: number;
  landingPageViews: number;
  checkoutsStarted: number;
  purchases: number;
}

export interface PullOptions {
  /** Test seam for the wait between retries */
  sleep?: (ms: number) => Promise<void>;
  /** Test seam for "now" */
  now?: Date;
}

export class MetaApiError extends Error {
  constructor(public code: number | null, public status: number, public subcode: number | null = null) {
    super(`Meta request failed (HTTP ${status}${code !== null ? `, code ${code}` : ''})`);
  }
}

export class MetaRateLimitError extends MetaApiError {
  constructor(code: number | null, status: number, subcode: number | null = null) {
    super(code, status, subcode);
    this.message = 'Meta is limiting requests';
  }
}

const RATE_LIMIT_CODES = new Set([4, 17, 613, 80000]);
const USAGE_LIMIT = 90;
const BACKOFF_MS = [2000, 8000, 30000];
const STATUS_BATCH = 50;
const FIELDS = 'account_currency,campaign_id,campaign_name,date_start,spend,impressions,inline_link_clicks,actions';

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Highest call_count (%) in the X-Business-Use-Case-Usage header, 0 when absent or unreadable. */
function usagePercent(response: Response): number {
  try {
    const raw = response.headers?.get?.('x-business-use-case-usage');
    if (!raw) return 0;
    let top = 0;
    for (const list of Object.values(JSON.parse(raw) as Record<string, any[]>)) {
      for (const u of list || []) top = Math.max(top, Number(u?.call_count) || 0);
    }
    return top;
  } catch {
    return 0;
  }
}

/**
 * One GET with backoff. A rate-limit reply waits and retries (2s, 8s, 30s), then throws MetaRateLimitError.
 * A reply that succeeds but shows usage at 90% or more is kept; the next call waits first.
 */
function makeClient(token: string, sleep: (ms: number) => Promise<void>) {
  let slowDown = false;
  return async function get(url: string): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      if (slowDown) {
        slowDown = false;
        await sleep(BACKOFF_MS[0]);
      }
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const usage = usagePercent(response);
      if (response.ok) {
        if (usage >= USAGE_LIMIT) slowDown = true;
        return response.json();
      }
      let err: any = {};
      try { err = ((await response.json()) as any)?.error || {}; } catch { /* no body */ }
      const code = typeof err.code === 'number' ? err.code : null;
      const subcode = typeof err.error_subcode === 'number' ? err.error_subcode : null;
      if (code === 190) throw new MetaApiError(190, response.status, subcode);
      if ((code !== null && RATE_LIMIT_CODES.has(code)) || usage >= USAGE_LIMIT) {
        if (attempt >= BACKOFF_MS.length) throw new MetaRateLimitError(code, response.status, subcode);
        logger.warn('Meta insights rate limited, waiting', { attempt: attempt + 1, code });
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      throw new MetaApiError(code, response.status, subcode);
    }
  };
}

const actionCount = (actions: any, type: string): number => {
  if (!Array.isArray(actions)) return 0;
  const hit = actions.find((a) => a?.action_type === type);
  const n = hit ? parseInt(String(hit.value), 10) : 0;
  return Number.isFinite(n) ? n : 0;
};
const count = (v: unknown): number => {
  const n = parseInt(String(v ?? 0), 10);
  return Number.isFinite(n) ? n : 0;
};

/** One Meta insights row to one InsightRow. Missing numbers are 0. No float math on spend. */
export function parseInsightRow(raw: any, fallbackCurrency = ''): InsightRow {
  return {
    campaignId: String(raw.campaign_id),
    campaignName: String(raw.campaign_name ?? ''),
    campaignStatus: null,
    date: String(raw.date_start),
    currency: raw.account_currency || fallbackCurrency,
    spend: Money.parse(raw.spend ?? '0').toFixed(4),
    impressions: count(raw.impressions),
    linkClicks: count(raw.inline_link_clicks),
    landingPageViews: actionCount(raw.actions, 'landing_page_view'),
    // fb_pixel_initiate_checkout only: omni_initiated_checkout is the same event again
    checkoutsStarted: actionCount(raw.actions, 'offsite_conversion.fb_pixel_initiate_checkout'),
    purchases: actionCount(raw.actions, 'offsite_conversion.fb_pixel_purchase'),
  };
}

/** Campaign-level daily insights for since..until (YYYY-MM-DD, account zone), following the paging links. */
export async function fetchCampaignInsights(
  token: string,
  accountId: string,
  since: string,
  until: string,
  opts: PullOptions = {},
): Promise<InsightRow[]> {
  const get = makeClient(token, opts.sleep ?? defaultSleep);
  const params = new URLSearchParams({
    level: 'campaign',
    time_increment: '1',
    time_range: JSON.stringify({ since, until }),
    fields: FIELDS,
    limit: '500',
  });
  const rows: InsightRow[] = [];
  let url: string | undefined = `${ADS_GRAPH_API_BASE}/act_${accountId.replace(/^act_/, '')}/insights?${params.toString()}`;
  while (url) {
    const body = await get(url);
    for (const raw of body.data || []) rows.push(parseInsightRow(raw));
    url = body.paging?.next || undefined;
  }

  const ids = [...new Set(rows.map((r) => r.campaignId))];
  const statuses = new Map<string, string>();
  for (let i = 0; i < ids.length; i += STATUS_BATCH) {
    const batch = ids.slice(i, i + STATUS_BATCH);
    try {
      const body = await get(`${ADS_GRAPH_API_BASE}/?${new URLSearchParams({ ids: batch.join(','), fields: 'effective_status' })}`);
      for (const id of batch) if (body?.[id]?.effective_status) statuses.set(id, String(body[id].effective_status));
    } catch (err) {
      // Status is a nice-to-have. A token or rate-limit failure still stops the pull.
      if (err instanceof MetaRateLimitError || (err as MetaApiError).code === 190) throw err;
      logger.warn('Meta campaign status lookup failed', { status: (err as MetaApiError).status });
    }
  }
  return rows.map((r) => ({ ...r, campaignStatus: statuses.get(r.campaignId) ?? null }));
}

/** The last `days` days of a zone, oldest first, today included. */
export function pullWindow(zone: string, days: number, now: Date = new Date()): string[] {
  const today = localDate(now, zone);
  return Array.from({ length: days }, (_, i) => shiftYmd(today, i - (days - 1)));
}

const failureText = (err: unknown): string => {
  if (err instanceof MetaRateLimitError) return 'Meta is limiting requests. The next pull will try again.';
  const code = (err as MetaApiError)?.code;
  if (code === 190) return 'Meta access was removed. Reconnect Meta Ads.';
  return 'The Meta pull failed. The next pull will try again.';
};

async function alertTwiceFailed(accountName: string, adAccountId: number): Promise<void> {
  try {
    for (const admin of await findTenantAdmins()) {
      await createNotification(
        String(admin.id),
        'meta_ads_pull',
        'Meta Ads pull failed',
        `Meta Ads pull failed twice for ${accountName}. Check Settings, Integrations.`,
        { adAccountId },
      );
    }
  } catch (err: any) {
    logger.error('Meta Ads pull alert failed', { error: safeErrorMessage(err) });
  }
}

/**
 * Pull the last `days` days for one ad account (run inside the tenant context) and upsert them.
 * Returns the dates pulled; [] when the account is skipped (off or disconnected) or the pull failed.
 * A failure is stored on the account (lastPullError, failedPullCount); the second one in a row alerts once.
 * Rows of a campaign that is gone from Meta are never deleted.
 */
export async function pullAccount(adAccountId: number, days = 3, opts: PullOptions = {}): Promise<string[]> {
  const account = await prisma.metaAdAccount.findFirst({ where: { id: adAccountId } });
  if (!account || !account.enabled || account.status === 'disconnected') return [];

  try {
    const token = decryptString(account.accessToken);
    if (!token) throw new MetaApiError(190, 0);
    const dates = pullWindow(account.timezone, days, opts.now);
    const rows = await fetchCampaignInsights(token, account.accountId, dates[0], dates[dates.length - 1], opts);

    const pulledAt = new Date();
    for (const r of rows) {
      const data = {
        campaignName: r.campaignName,
        ...(r.campaignStatus ? { campaignStatus: r.campaignStatus } : {}),
        currency: r.currency || account.currency,
        spend: r.spend,
        impressions: r.impressions,
        linkClicks: r.linkClicks,
        landingPageViews: r.landingPageViews,
        checkoutsStarted: r.checkoutsStarted,
        purchases: r.purchases,
        pulledAt,
      };
      await prisma.metaSpendDay.upsert({
        where: { adAccountId_campaignId_date: { adAccountId, campaignId: r.campaignId, date: utcDateOfYmd(r.date) } },
        create: { adAccountId, campaignId: r.campaignId, date: utcDateOfYmd(r.date), tenantId: account.tenantId, ...data },
        update: data,
      });
    }
    await prisma.metaAdAccount.update({
      where: { id: adAccountId },
      data: { lastPulledAt: pulledAt, lastPullError: null, failedPullCount: 0 },
    });
    return dates;
  } catch (err) {
    // Token errors and Meta codes only. Never the token, never the raw URL.
    logger.warn('Meta insights pull failed', { adAccountId, error: safeErrorMessage(err) });
    if ((err as MetaApiError)?.code === 190) await metaAdsApiError(adAccountId, err);
    const updated = await prisma.metaAdAccount.update({
      where: { id: adAccountId },
      data: { lastPullError: failureText(err), failedPullCount: { increment: 1 } },
    });
    if (updated.failedPullCount === 2) await alertTwiceFailed(account.name, adAccountId);
    return [];
  }
}
