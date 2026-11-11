import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { getTenantId, runInTenant } from '../../utils/tenantContext';

// T14: the daily token refresh covers every tenant's config, each in its own context.

const mockRefreshLongLivedToken = jest.fn<(t: string) => Promise<any>>();
jest.mock('../../services/metaOAuthService', () => ({
  isOAuthConfigured: () => true,
  tokenFallbackExpiry: () => new Date(Date.now() + 60 * 86400000).toISOString(),
  getRedirectUri: () => 'http://localhost/cb',
  refreshLongLivedToken: (...a: any[]) => (mockRefreshLongLivedToken as any)(...a),
}));

jest.mock('../../utils/providerCrypto', () => ({
  decryptProviderSecrets: (_k: string, v: any) => v,
  encryptProviderSecrets: (_k: string, v: any) => v,
}));

const mockNotify = jest.fn<(...a: any[]) => Promise<any>>();
jest.mock('../../services/notificationService', () => ({
  createNotification: (...a: any[]) => mockNotify(...a),
  findTenantAdmins: async () => [{ id: 1 }, { id: 2 }],
}));

jest.mock('../../services/whatsappService', () => ({
  clearWhatsAppConfigCache: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { refreshAllTenantTokens, refreshTokenIfNeeded } from '../../services/whatsappTokenRefreshService';

const soon = new Date(Date.now() + 86400000).toISOString(); // inside the 7-day buffer

describe('refreshAllTenantTokens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prismaMock.tenant.findMany as any).mockResolvedValue([{ id: 'tenant-a' }, { id: 'tenant-b' }]);
  });

  it('refreshes the config of every tenant, not one arbitrary tenant', async () => {
    const seen: Array<string | null> = [];
    (prismaMock.systemConfig.findFirst as any).mockImplementation(async () => {
      seen.push(getTenantId());
      return {
        id: `cfg-${getTenantId()}`,
        whatsappProvider: { authMode: 'oauth', accessToken: `tok-${getTenantId()}`, oauthTokenExpiry: soon },
      };
    });
    mockRefreshLongLivedToken.mockResolvedValue({ accessToken: 'new', expiresAt: new Date(Date.now() + 60 * 86400000).toISOString() });
    (prismaMock.systemConfig.update as any).mockResolvedValue({});

    await refreshAllTenantTokens();

    expect(seen).toEqual(['tenant-a', 'tenant-b']);
    expect(mockRefreshLongLivedToken).toHaveBeenCalledWith('tok-tenant-a');
    expect(mockRefreshLongLivedToken).toHaveBeenCalledWith('tok-tenant-b');
    const updatedIds = (prismaMock.systemConfig.update as any).mock.calls.map((c: any[]) => c[0].where.id);
    expect(updatedIds).toEqual(['cfg-tenant-a', 'cfg-tenant-b']);
  });
});

describe('refresh failure alert (T04)', () => {
  const config = (extra: Record<string, unknown> = {}) => ({
    id: 5,
    whatsappProvider: { authMode: 'oauth', accessToken: 'tok', oauthTokenExpiry: soon, ...extra },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockRefreshLongLivedToken.mockRejectedValue(new Error('refresh failed: 400'));
    (prismaMock.systemConfig.update as any).mockResolvedValue({});
  });

  it('alerts the owner and admins once and records the day', async () => {
    (prismaMock.systemConfig.findFirst as any).mockResolvedValue(config());
    const result = await runInTenant('tenant-a', () => refreshTokenIfNeeded());
    expect(result.error).toContain('refresh failed');
    expect(mockNotify).toHaveBeenCalledTimes(2);
    expect(mockNotify.mock.calls[0][3]).toBe('WhatsApp connection could not refresh. Reconnect WhatsApp in Settings.');
    const saved = (prismaMock.systemConfig.update as any).mock.calls[0][0].data.whatsappProvider;
    expect(saved.oauthRefreshFailedAt.slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));
  });

  it('does not alert again the same day', async () => {
    (prismaMock.systemConfig.findFirst as any).mockResolvedValue(config({ oauthRefreshFailedAt: new Date().toISOString() }));
    await runInTenant('tenant-a', () => refreshTokenIfNeeded());
    expect(mockNotify).not.toHaveBeenCalled();
    expect(prismaMock.systemConfig.update).not.toHaveBeenCalled();
  });

  it('alerts again the next day', async () => {
    (prismaMock.systemConfig.findFirst as any).mockResolvedValue(config({ oauthRefreshFailedAt: new Date(Date.now() - 2 * 86400000).toISOString() }));
    await runInTenant('tenant-a', () => refreshTokenIfNeeded());
    expect(mockNotify).toHaveBeenCalledTimes(2);
  });

  it('clears the marker on success', async () => {
    (prismaMock.systemConfig.findFirst as any).mockResolvedValue(config({ oauthRefreshFailedAt: new Date().toISOString() }));
    mockRefreshLongLivedToken.mockResolvedValue({ accessToken: 'new', expiresAt: new Date(Date.now() + 60 * 86400000).toISOString() });
    await runInTenant('tenant-a', () => refreshTokenIfNeeded());
    const saved = (prismaMock.systemConfig.update as any).mock.calls[0][0].data.whatsappProvider;
    expect(saved.oauthRefreshFailedAt).toBeUndefined();
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
