/**
 * MAN-91: the auth.null_tenant_context tripwire must PAGE on-call, not just log.
 *
 * mintTokens is the single fail-closed mint surface. When no active store
 * resolves (owner with no default membership, corrupt state), it must refuse to
 * mint AND page on-call — that event is the alarm for the fail-open tenant
 * extension. These tests mock the prisma + alerting seams and assert both.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import '../mocks/prisma.mock';
import prismaMock from '../mocks/prisma.mock';

jest.mock('../../utils/alerting', () => ({
  __esModule: true,
  pageOnCall: jest.fn(async () => {}),
}));

import { mintTokens } from '../../utils/mintTokens';
import { pageOnCall } from '../../utils/alerting';

const owner = { id: 42, email: 'owner@example.com', role: 'super_admin' as any, tenantId: null };

describe('mintTokens null-tenant on-call tripwire (MAN-91)', () => {
  beforeEach(() => {
    (pageOnCall as jest.Mock).mockClear();
  });

  it('pages on-call and refuses to mint when no active store resolves', async () => {
    (prismaMock.storeMembership.findFirst as any).mockResolvedValue(null);

    await expect(mintTokens(owner)).rejects.toMatchObject({
      statusCode: 403,
      errorCode: 'TENANT_UNRESOLVED',
    });

    expect(pageOnCall).toHaveBeenCalledTimes(1);
    expect(pageOnCall).toHaveBeenCalledWith(
      'auth.null_tenant_context',
      expect.objectContaining({ userId: 42, email: 'owner@example.com' }),
    );
  });

  it('does NOT page and mints a scoped token when a default store resolves', async () => {
    (prismaMock.storeMembership.findFirst as any).mockResolvedValue({ tenantId: 'tenant-1' });

    const out = await mintTokens(owner);

    expect(out.tenantId).toBe('tenant-1');
    expect(typeof out.accessToken).toBe('string');
    expect(out.accessToken.length).toBeGreaterThan(0);
    expect(pageOnCall).not.toHaveBeenCalled();
  });
});
