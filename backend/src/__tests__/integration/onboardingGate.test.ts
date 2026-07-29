/**
 * Onboarding auto-create gate (MAN-94)
 *
 * setupOnboarding auto-creates a "company-N" tenant for a user with no tenant.
 * A multi-store OWNER is legitimately null-tenant (they provision via the
 * platform console) and always has a StoreMembership — so the auto-create must
 * be gated OFF for them, or a stray tenant is minted on every onboarding hit.
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const SUFFIX = Date.now();

let storeId: string;
let ownerId: number;
let tokenNull: string; // owner token carrying a NULL active tenant

beforeAll(async () => {
  const store = await prismaBase.tenant.create({ data: { name: `S ${SUFFIX}`, slug: `s-${SUFFIX}`, subscriptionStatus: 'active' } });
  storeId = store.id;

  const owner = await prismaBase.user.create({
    data: { email: `gate-owner-${SUFFIX}@test.com`, password: 'x', role: 'super_admin', firstName: 'Gate', lastName: 'Owner', tenantId: null },
  });
  ownerId = owner.id;
  await prismaBase.storeMembership.create({ data: { userId: ownerId, tenantId: storeId, role: 'super_admin', isDefault: true } });

  tokenNull = generateAccessToken({ id: ownerId, email: owner.email, role: 'super_admin', tenantId: null as any });
});

afterAll(async () => {
  // Defensive: if the gate ever regressed and a stray tenant WAS created, clean it too.
  const stray = await prismaBase.tenant.findFirst({ where: { slug: `company-${ownerId}` } });
  await prismaBase.storeMembership.deleteMany({ where: { userId: ownerId } });
  await prismaBase.user.deleteMany({ where: { id: ownerId } });
  const tenantIds = [storeId, ...(stray ? [stray.id] : [])];
  await prismaBase.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prismaBase.$disconnect();
});

describe('onboarding auto-create gate (null-tenant owner)', () => {
  it('does NOT auto-create a stray tenant for a null-tenant owner with a membership', async () => {
    await request(app)
      .post('/api/onboarding/setup')
      .set('Authorization', `Bearer ${tokenNull}`)
      .send({ country: 'NG', currency: 'NGN' });

    const stray = await prismaBase.tenant.findFirst({ where: { slug: `company-${ownerId}` } });
    expect(stray).toBeNull();
  });
});
