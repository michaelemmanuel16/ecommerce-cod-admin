import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';

const findFirst = jest.fn<any>();
const update = jest.fn<any>();
jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: { systemConfig: { findFirst: (...a: any[]) => findFirst(...a), update: (...a: any[]) => update(...a) } },
}));
const getPending = jest.fn<any>();
jest.mock('../../utils/whatsappOAuthState', () => ({
  whatsappOAuthStore: () => ({ getPending, deletePending: jest.fn() }),
}));
jest.mock('../../utils/tenantContext', () => ({ getTenantId: () => 't1' }));
jest.mock('../../services/whatsappService', () => ({ clearWhatsAppConfigCache: jest.fn() }));
jest.mock('../../services/adminService', () => ({ adminService: { createAuditLog: jest.fn() } }));
const subscribe = jest.fn<any>();
jest.mock('../../services/metaOAuthService', () => ({ subscribeWABAToApp: (...a: any[]) => subscribe(...a) }));

import { selectPhoneNumber } from '../../controllers/whatsappOAuthController';

const res = () => {
  const r: any = {};
  r.status = jest.fn(() => r);
  r.json = jest.fn(() => r);
  return r;
};

describe('selectPhoneNumber saves the WABA id (T51)', () => {
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue({ id: 5, whatsappProvider: {} });
    update.mockReset();
    subscribe.mockReset().mockResolvedValue(true);
    getPending.mockReset().mockResolvedValue({
      accessToken: 'tok',
      oauthTokenExpiry: new Date(),
      oauthUserId: 'u',
      phones: [{ id: 'p1', display_phone_number: '+233', verified_name: 'Shop', quality_rating: 'GREEN', wabaId: '999' }],
    });
  });

  it('stores the WABA of the picked phone as wabaId, with no wabaId in the request', async () => {
    const r = res();
    await selectPhoneNumber({ user: { id: 1 }, body: { phoneNumberId: 'p1' } } as any, r);
    expect(update.mock.calls[0][0].data.whatsappProvider.wabaId).toBe('999');
    expect(subscribe).toHaveBeenCalledWith('999', 'tok');
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });
});
