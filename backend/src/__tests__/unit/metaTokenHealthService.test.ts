import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaMock } from '../mocks/prisma.mock';
import { runInTenant } from '../../utils/tenantContext';

// T04 (COD-71): token health transitions, and one alert per change.

const mockDebug = jest.fn<(t: string) => Promise<any>>();
jest.mock('../../services/metaOAuthService', () => ({
  debugToken: (t: string) => mockDebug(t),
}));
const mockNotify = jest.fn<(...a: any[]) => Promise<any>>();
jest.mock('../../services/inbox/inboxService', () => ({
  notify: (...a: any[]) => mockNotify(...a),
}));

import { checkAdsTokens, metaAdsApiError } from '../../services/metaTokenHealthService';

const DAY = 86400000;
const row = (id: number, over: Record<string, unknown> = {}) => ({
  id, name: `Acct ${id}`, status: 'connected', statusReason: null, accessToken: 'tok', tokenType: 'user', ...over,
});
const dbg = (over: Record<string, unknown> = {}) => ({
  isValid: true, type: 'USER', expiresAt: new Date(Date.now() + 40 * DAY), scopes: ['ads_read'], ...over,
});

describe('checkAdsTokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.metaAdAccount.updateMany as any).mockResolvedValue({ count: 1 });
  });

  it('a healthy token changes nothing and sends nothing', async () => {
    (prismaMock.metaAdAccount.findMany as any).mockResolvedValue([row(1)]);
    mockDebug.mockResolvedValue(dbg());
    await runInTenant('tenant-a', () => checkAdsTokens());
    expect(prismaMock.metaAdAccount.updateMany).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('checks a shared token once and disconnects every row that uses it, with one alert per admin', async () => {
    (prismaMock.metaAdAccount.findMany as any).mockResolvedValue([row(1), row(2)]);
    mockDebug.mockResolvedValue(dbg({ isValid: false }));
    await runInTenant('tenant-a', () => checkAdsTokens());
    expect(mockDebug).toHaveBeenCalledTimes(1);
    expect((prismaMock.metaAdAccount.updateMany as any).mock.calls[0][0]).toEqual({
      where: { id: { in: [1, 2] } },
      data: { status: 'disconnected', statusReason: 'Meta access was removed. Reconnect Meta Ads.' },
    });
    expect(mockNotify).toHaveBeenCalledTimes(1); // one notify to the owner
  });

  it('does not alert again while the state stays the same', async () => {
    (prismaMock.metaAdAccount.findMany as any).mockResolvedValue([
      row(1, { status: 'disconnected', statusReason: 'Meta access was removed. Reconnect Meta Ads.' }),
    ]);
    mockDebug.mockResolvedValue(dbg({ isValid: false }));
    await runInTenant('tenant-a', () => checkAdsTokens());
    expect(prismaMock.metaAdAccount.updateMany).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('missing ads_read disconnects and names the permission', async () => {
    (prismaMock.metaAdAccount.findMany as any).mockResolvedValue([row(1)]);
    mockDebug.mockResolvedValue(dbg({ scopes: ['business_management'] }));
    await runInTenant('tenant-a', () => checkAdsTokens());
    expect((prismaMock.metaAdAccount.updateMany as any).mock.calls[0][0].data).toEqual({
      status: 'disconnected', statusReason: 'Missing permission: ads_read',
    });
    expect(mockNotify).toHaveBeenCalled();
  });

  it('a user token expiring within 7 days stays connected with an expiry note and one alert', async () => {
    const expiresAt = new Date(Date.UTC(2030, 11, 12));
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(expiresAt.getTime() - 3 * DAY);
    try {
      (prismaMock.metaAdAccount.findMany as any).mockResolvedValue([row(1)]);
      mockDebug.mockResolvedValue(dbg({ expiresAt }));
      await runInTenant('tenant-a', () => checkAdsTokens());
      expect((prismaMock.metaAdAccount.updateMany as any).mock.calls[0][0].data).toEqual({
        status: 'connected', statusReason: 'Expires on 12 Dec 2030. Reconnect Meta Ads.',
      });
      expect(mockNotify).toHaveBeenCalledTimes(1);

      // same state next day: no second alert
      jest.clearAllMocks();
      (prismaMock.metaAdAccount.findMany as any).mockResolvedValue([
        row(1, { statusReason: 'Expires on 12 Dec 2030. Reconnect Meta Ads.' }),
      ]);
      await runInTenant('tenant-a', () => checkAdsTokens());
      expect(mockNotify).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a valid token again clears a Disconnected row without an alert', async () => {
    (prismaMock.metaAdAccount.findMany as any).mockResolvedValue([
      row(1, { status: 'disconnected', statusReason: 'Missing permission: ads_read' }),
    ]);
    mockDebug.mockResolvedValue(dbg());
    await runInTenant('tenant-a', () => checkAdsTokens());
    expect((prismaMock.metaAdAccount.updateMany as any).mock.calls[0][0].data).toEqual({ status: 'connected', statusReason: null });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('a failed debug_token call (network) changes nothing', async () => {
    (prismaMock.metaAdAccount.findMany as any).mockResolvedValue([row(1)]);
    mockDebug.mockRejectedValue(new Error('boom'));
    await runInTenant('tenant-a', () => checkAdsTokens());
    expect(prismaMock.metaAdAccount.updateMany).not.toHaveBeenCalled();
  });
});

describe('metaAdsApiError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.metaAdAccount.updateMany as any).mockResolvedValue({ count: 1 });
  });

  it('error 190 marks the account disconnected and alerts once', async () => {
    (prismaMock.metaAdAccount.findFirst as any).mockResolvedValue(row(5));
    expect(await runInTenant('tenant-a', () => metaAdsApiError(5, { code: 190 }))).toBe(true);
    expect((prismaMock.metaAdAccount.updateMany as any).mock.calls[0][0].where).toEqual({ id: { in: [5] } });
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('any other error is ignored', async () => {
    expect(await metaAdsApiError(5, { code: 4 })).toBe(false);
    expect(prismaMock.metaAdAccount.updateMany).not.toHaveBeenCalled();
  });
});
