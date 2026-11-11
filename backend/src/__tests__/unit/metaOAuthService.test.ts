import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import '../mocks/logger.mock';
import {
  generateAuthUrl,
  generateAdsAuthUrl,
  getRedirectUri,
  getAdsRedirectUri,
  debugToken,
  fetchAdAccounts,
} from '../../services/metaOAuthService';

// T04 (COD-71): the WhatsApp login URL is pinned; the ads URL and the new Graph helpers are checked with Meta mocked.

describe('metaOAuthService (T04)', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.META_APP_ID = '123';
    process.env.META_APP_SECRET = 'sekret';
    process.env.BACKEND_URL = 'https://api.example.com';
    delete process.env.META_ADS_CONFIG_ID;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('WhatsApp auth URL is unchanged (v21, WhatsApp scopes, whatsapp callback)', () => {
    expect(getRedirectUri()).toBe('https://api.example.com/api/whatsapp/oauth/callback');
    expect(generateAuthUrl(getRedirectUri(), 'st')).toBe(
      'https://www.facebook.com/v21.0/dialog/oauth?client_id=123&redirect_uri=https%3A%2F%2Fapi.example.com%2Fapi%2Fwhatsapp%2Foauth%2Fcallback&state=st&scope=whatsapp_business_management%2Cwhatsapp_business_messaging&response_type=code'
    );
  });

  it('ads auth URL without META_ADS_CONFIG_ID asks for ads_read and business_management on v25', () => {
    expect(getAdsRedirectUri()).toBe('https://api.example.com/api/meta-ads/oauth/callback');
    const url = new URL(generateAdsAuthUrl(getAdsRedirectUri(), 'st'));
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v25.0/dialog/oauth');
    expect(url.searchParams.get('scope')).toBe('ads_read,business_management');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('config_id')).toBeNull();
    expect(url.searchParams.get('state')).toBe('st');
  });

  it('ads auth URL with META_ADS_CONFIG_ID uses Facebook Login for Business', () => {
    process.env.META_ADS_CONFIG_ID = '999';
    const url = new URL(generateAdsAuthUrl(getAdsRedirectUri(), 'st'));
    expect(url.searchParams.get('config_id')).toBe('999');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('override_default_response_type')).toBe('true');
    expect(url.searchParams.get('scope')).toBeNull();
  });

  it('debugToken: a permission listed only in granular_scopes counts (system user token)', async () => {
    (global as any).fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ data: { is_valid: true, type: 'SYSTEM_USER', expires_at: 0, scopes: ['business_management'], granular_scopes: [{ scope: 'business_management' }, { scope: 'ads_read', target_ids: ['864465431329981'] }] } }),
    }));
    expect((await debugToken('tok')).scopes).toEqual(['business_management', 'ads_read']);
  });

  it('debugToken: expires_at 0 means never (null); scopes and type are read', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ data: { is_valid: true, type: 'SYSTEM_USER', expires_at: 0, scopes: ['ads_read'] } }),
    }));
    (global as any).fetch = fetchMock;
    expect(await debugToken('tok')).toEqual({ isValid: true, type: 'SYSTEM_USER', expiresAt: null, scopes: ['ads_read'] });
    const url = String((fetchMock.mock.calls[0] as any[])[0]);
    expect(url).toContain('/v25.0/debug_token');
    expect(url).toContain('access_token=123%7Csekret');

    (global as any).fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ data: { is_valid: false, type: 'USER', expires_at: 1900000000, scopes: [] } }),
    }));
    const r = await debugToken('tok');
    expect(r.isValid).toBe(false);
    expect(r.expiresAt).toEqual(new Date(1900000000 * 1000));
  });

  it('fetchAdAccounts follows the paging cursor and keeps the token in the header', async () => {
    const page = (data: any[], after?: string) => ({
      ok: true,
      json: async () => ({ data, paging: after ? { cursors: { after }, next: 'https://graph.facebook.com/next?access_token=LEAK' } : { cursors: { after: 'z' } } }),
    });
    const fetchMock = jest.fn()
      .mockResolvedValueOnce(page([{ account_id: '1', name: 'A', currency: 'NGN', timezone_name: 'Africa/Lagos', account_status: 1 }], 'c1'))
      .mockResolvedValueOnce(page([{ account_id: '2', name: 'B', currency: 'USD', timezone_name: 'America/New_York', account_status: 1 }]));
    (global as any).fetch = fetchMock;

    const accounts = await fetchAdAccounts('tok');
    expect(accounts.map((a) => a.accountId)).toEqual(['1', '2']);
    expect(accounts[0]).toMatchObject({ name: 'A', currency: 'NGN', timezone: 'Africa/Lagos' });
    const [url1, opts1] = fetchMock.mock.calls[0] as [string, any];
    const [url2] = fetchMock.mock.calls[1] as [string, any];
    expect(url1).toContain('/v25.0/me/adaccounts?fields=account_id%2Cname%2Ccurrency%2Ctimezone_name%2Caccount_status');
    expect(url2).toContain('after=c1');
    expect(url2).not.toContain('LEAK');
    expect(url1).not.toContain('tok');
    expect(opts1.headers.Authorization).toBe('Bearer tok');
  });
});
