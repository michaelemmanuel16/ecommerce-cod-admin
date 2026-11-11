import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaMock } from '../mocks/prisma.mock';
import fixture from '../fixtures/metaInsights.json';

// T05 (COD-71): parse, paging, backoff, token error, never delete, window in the account zone. Meta HTTP is mocked.

const mockApiError = jest.fn<(...a: any[]) => Promise<boolean>>();
jest.mock('../../services/metaTokenHealthService', () => ({
  metaAdsApiError: (...a: any[]) => mockApiError(...a),
}));
const mockNotify = jest.fn<(...a: any[]) => Promise<any>>();
jest.mock('../../services/notificationService', () => ({
  createNotification: (...a: any[]) => mockNotify(...a),
  findTenantAdmins: async () => [{ id: 1 }, { id: 2 }],
}));
jest.mock('../../utils/providerCrypto', () => ({
  decryptString: (v: string) => (v ? `plain-${v}` : null),
}));

import {
  fetchCampaignInsights, parseInsightRow, pullAccount, pullWindow, MetaRateLimitError,
} from '../../services/marketing/metaInsightsService';

type Reply = { ok?: boolean; status?: number; body: unknown; usage?: number };
let replies: Reply[];
const urls: string[] = [];
const headersSeen: any[] = [];

function mockFetch() {
  (global as any).fetch = jest.fn(async (url: string, init: any) => {
    urls.push(url);
    headersSeen.push(init?.headers);
    const r = replies.shift();
    if (!r) throw new Error('unexpected fetch');
    return {
      ok: r.ok !== false,
      status: r.status ?? (r.ok === false ? 400 : 200),
      json: async () => r.body,
      headers: { get: (k: string) => (k.toLowerCase() === 'x-business-use-case-usage' && r.usage !== undefined
        ? JSON.stringify({ '1001': [{ type: 'ads_insights', call_count: r.usage }] }) : null) },
    };
  });
}
const sleeps: number[] = [];
const sleep = async (ms: number) => { sleeps.push(ms); };

beforeEach(() => {
  jest.clearAllMocks();
  replies = [];
  urls.length = 0;
  headersSeen.length = 0;
  sleeps.length = 0;
  mockFetch();
});

describe('parseInsightRow', () => {
  it('reads link clicks, landing views, checkouts and purchases; omni checkout is not added', () => {
    const r = parseInsightRow(fixture.page1.data[0]);
    expect(r).toMatchObject({
      campaignId: '6001', date: '2026-11-09', currency: 'NGN', spend: '43700.5500',
      impressions: 20000, linkClicks: 330, landingPageViews: 234, checkoutsStarted: 23, purchases: 7,
    });
  });
  it('missing values are 0', () => {
    const r = parseInsightRow(fixture.page1.data[1]);
    expect(r).toMatchObject({ spend: '0.1000', impressions: 0, linkClicks: 0, landingPageViews: 0, checkoutsStarted: 0, purchases: 0 });
  });
});

describe('fetchCampaignInsights', () => {
  it('sends the token in a header only, asks for the right fields, follows paging, adds status', async () => {
    replies = [{ body: fixture.page1 }, { body: fixture.page2 }, { body: fixture.statuses }];
    const rows = await fetchCampaignInsights('SECRET', '1001', '2026-11-09', '2026-11-11', { sleep });
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.campaignId === '6002')!.campaignStatus).toBe('PAUSED');
    const first = new URL(urls[0]);
    expect(first.pathname).toBe('/v25.0/act_1001/insights');
    expect(first.searchParams.get('level')).toBe('campaign');
    expect(first.searchParams.get('time_increment')).toBe('1');
    expect(first.searchParams.get('time_range')).toBe('{"since":"2026-11-09","until":"2026-11-11"}');
    expect(first.searchParams.get('limit')).toBe('500');
    expect(first.searchParams.get('fields')).toContain('inline_link_clicks');
    expect(first.searchParams.has('action_attribution_windows')).toBe(false);
    expect(urls[1]).toContain('after=b');
    const status = new URL(urls[2]);
    expect(status.searchParams.get('ids')).toBe('6001,6002');
    expect(status.searchParams.get('fields')).toBe('effective_status');
    expect(urls.join(' ')).not.toContain('SECRET');
    expect(headersSeen.every((h) => h.Authorization === 'Bearer SECRET')).toBe(true);
  });

  it('a rate-limit reply waits 2s, retries, and keeps every day', async () => {
    replies = [
      { ok: false, body: fixture.rateLimitError },
      { ok: false, body: fixture.adsInsightsLimitError },
      { body: fixture.page2 },
      { body: { '6001': { effective_status: 'ACTIVE' } } },
    ];
    const rows = await fetchCampaignInsights('T', '1001', '2026-11-10', '2026-11-10', { sleep });
    expect(sleeps).toEqual([2000, 8000]);
    expect(rows).toHaveLength(1);
    expect(rows[0].date).toBe('2026-11-10');
  });

  it('gives up after 2s, 8s, 30s with MetaRateLimitError and no token in the message', async () => {
    replies = Array.from({ length: 4 }, () => ({ ok: false, body: fixture.rateLimitError }));
    const err = await fetchCampaignInsights('SECRET', '1001', 'a', 'b', { sleep }).catch((e) => e);
    expect(err).toBeInstanceOf(MetaRateLimitError);
    expect(sleeps).toEqual([2000, 8000, 30000]);
    expect(err.message).not.toContain('SECRET');
  });

  it('a usage header at 90% on a failed reply counts as a rate limit; on a good reply it slows the next call', async () => {
    replies = [{ ok: false, status: 400, body: { error: { code: 1 } }, usage: 95 }, { body: fixture.page2, usage: 92 }, { body: fixture.statuses }];
    await fetchCampaignInsights('T', '1001', 'a', 'b', { sleep });
    expect(sleeps).toEqual([2000, 2000]);
  });

  it('error 190 throws at once with code 190 (no retry)', async () => {
    replies = [{ ok: false, body: fixture.tokenError }];
    const err = await fetchCampaignInsights('SECRET', '1001', 'a', 'b', { sleep }).catch((e) => e);
    expect(err.code).toBe(190);
    expect(sleeps).toEqual([]);
    expect(err.message).not.toContain('SECRET');
  });
});

describe('pullWindow', () => {
  it('uses the date in the account zone, today included', () => {
    const now = new Date('2026-11-11T23:30:00Z');
    expect(pullWindow('Africa/Lagos', 3, now)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    expect(pullWindow('Africa/Accra', 3, now)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    expect(pullWindow('Pacific/Auckland', 1, now)).toEqual(['2026-11-12']);
    expect(pullWindow('America/Los_Angeles', 1, now)).toEqual(['2026-11-11']);
  });
});

describe('pullAccount', () => {
  const account = (over: Record<string, unknown> = {}) => ({
    id: 7, accountId: '1001', name: 'MG Nigeria', currency: 'NGN', timezone: 'Africa/Accra', enabled: true,
    status: 'connected', accessToken: 'enc', tenantId: 't1', ...over,
  });
  beforeEach(() => {
    (prismaMock.metaSpendDay.upsert as any).mockResolvedValue({});
    (prismaMock.metaAdAccount.update as any).mockResolvedValue({ failedPullCount: 1 });
  });

  it('skips a disabled or disconnected account without calling Meta', async () => {
    (prismaMock.metaAdAccount.findFirst as any).mockResolvedValueOnce(account({ enabled: false }));
    expect(await pullAccount(7)).toEqual([]);
    (prismaMock.metaAdAccount.findFirst as any).mockResolvedValueOnce(account({ status: 'disconnected' }));
    expect(await pullAccount(7)).toEqual([]);
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('upserts every row on (account, campaign, date), sets lastPulledAt, clears the error', async () => {
    (prismaMock.metaAdAccount.findFirst as any).mockResolvedValue(account());
    replies = [{ body: fixture.page1 }, { body: fixture.page2 }, { body: fixture.statuses }];
    const dates = await pullAccount(7, 3, { sleep, now: new Date('2026-11-11T10:00:00Z') });
    expect(dates).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
    const calls = (prismaMock.metaSpendDay.upsert as any).mock.calls.map((c: any[]) => c[0]);
    expect(calls).toHaveLength(3);
    expect(calls[0].where).toEqual({ adAccountId_campaignId_date: { adAccountId: 7, campaignId: '6001', date: new Date('2026-11-09T00:00:00.000Z') } });
    expect(calls[0].create).toMatchObject({ tenantId: 't1', currency: 'NGN', spend: '43700.5500', purchases: 7, campaignStatus: 'ACTIVE' });
    expect(calls[0].update).not.toHaveProperty('tenantId');
    expect((prismaMock.metaAdAccount.update as any).mock.calls[0][0].data).toMatchObject({ lastPullError: null, failedPullCount: 0 });
    // a pull never deletes
    expect((prismaMock.metaSpendDay as any).deleteMany).not.toHaveBeenCalled();
    expect(urls[0]).toContain('2026-11-09');
  });

  it('a campaign missing from the new data keeps its rows (nothing deleted, nothing upserted for it)', async () => {
    (prismaMock.metaAdAccount.findFirst as any).mockResolvedValue(account());
    replies = [{ body: { data: [fixture.page1.data[0]] } }, { body: { '6001': { effective_status: 'ACTIVE' } } }];
    await pullAccount(7, 3, { sleep });
    expect((prismaMock.metaSpendDay.upsert as any).mock.calls).toHaveLength(1);
    expect((prismaMock.metaSpendDay as any).deleteMany).not.toHaveBeenCalled();
    expect((prismaMock.metaSpendDay as any).delete).not.toHaveBeenCalled();
  });

  it('190 marks the account disconnected and records a plain error without the token', async () => {
    (prismaMock.metaAdAccount.findFirst as any).mockResolvedValue(account());
    replies = [{ ok: false, body: fixture.tokenError }];
    expect(await pullAccount(7, 3, { sleep })).toEqual([]);
    expect(mockApiError).toHaveBeenCalledTimes(1);
    expect(mockApiError.mock.calls[0][0]).toBe(7);
    const data = (prismaMock.metaAdAccount.update as any).mock.calls[0][0].data;
    expect(data.lastPullError).toBe('Meta access was removed. Reconnect Meta Ads.');
    expect(data.failedPullCount).toEqual({ increment: 1 });
    expect(JSON.stringify(data)).not.toContain('plain-enc');
  });

  it('a rate-limit failure stores a plain error and raises the count', async () => {
    (prismaMock.metaAdAccount.findFirst as any).mockResolvedValue(account());
    replies = Array.from({ length: 4 }, () => ({ ok: false, body: fixture.rateLimitError }));
    await pullAccount(7, 3, { sleep });
    expect(mockApiError).not.toHaveBeenCalled();
    expect((prismaMock.metaAdAccount.update as any).mock.calls[0][0].data.lastPullError).toMatch(/limiting requests/);
  });

  it('alerts the admins once, at the second failure only', async () => {
    (prismaMock.metaAdAccount.findFirst as any).mockResolvedValue(account());
    for (const [count, alerts] of [[1, 0], [2, 2], [3, 0]] as const) {
      mockNotify.mockClear();
      (prismaMock.metaAdAccount.update as any).mockResolvedValue({ failedPullCount: count });
      replies = [{ ok: false, body: { error: { code: 1 } } }];
      await pullAccount(7, 3, { sleep });
      expect(mockNotify).toHaveBeenCalledTimes(alerts);
    }
  });
});
