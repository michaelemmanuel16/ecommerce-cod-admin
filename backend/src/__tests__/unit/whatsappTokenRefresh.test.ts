import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { getTenantId } from '../../utils/tenantContext';

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

jest.mock('../../services/whatsappService', () => ({
  clearWhatsAppConfigCache: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { refreshAllTenantTokens } from '../../services/whatsappTokenRefreshService';

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
