/**
 * Store-core acceptance tests (MAN-108)
 *
 * Proves the three acceptance criteria:
 *  1. mintTokens fails CLOSED — a user with no resolvable active store throws
 *     403 TENANT_UNRESOLVED, never a null-tenant token.
 *  2. GET /api/stores returns exactly the caller's StoreMembership rows.
 *  3. POST /api/stores/switch re-mints a token scoped to an owned store, and
 *     403s (NOT_A_MEMBER) for a store the caller does not belong to.
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken, verifyAccessToken } from '../../utils/jwt';
import { mintTokens } from '../../utils/mintTokens';

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

let tenantAId: string; // owner is a member (default)
let tenantBId: string; // owner is a member (non-default)
let tenantCId: string; // owner is NOT a member
let ownerId: number;
let orphanId: number; // user with null tenantId and no membership
let ownerToken: string;

beforeAll(async () => {
  const [a, b, c] = await Promise.all([
    prismaBase.tenant.create({ data: { name: `A ${SUFFIX}`, slug: `a-${SUFFIX}`, subscriptionStatus: 'active' } }),
    prismaBase.tenant.create({ data: { name: `B ${SUFFIX}`, slug: `b-${SUFFIX}`, subscriptionStatus: 'active' } }),
    prismaBase.tenant.create({ data: { name: `C ${SUFFIX}`, slug: `c-${SUFFIX}`, subscriptionStatus: 'active' } }),
  ]);
  tenantAId = a.id; tenantBId = b.id; tenantCId = c.id;

  const owner = await prismaBase.user.create({
    data: {
      email: `owner-${SUFFIX}@test.com`, password: 'x', role: 'super_admin',
      firstName: 'Own', lastName: 'Er', tenantId: tenantAId,
    },
  });
  ownerId = owner.id;

  const orphan = await prismaBase.user.create({
    data: {
      email: `orphan-${SUFFIX}@test.com`, password: 'x', role: 'super_admin',
      firstName: 'Or', lastName: 'Phan', tenantId: null,
    },
  });
  orphanId = orphan.id;

  await prismaBase.storeMembership.createMany({
    data: [
      { userId: ownerId, tenantId: tenantAId, role: 'super_admin', isDefault: true },
      { userId: ownerId, tenantId: tenantBId, role: 'super_admin', isDefault: false },
    ],
  });

  ownerToken = generateAccessToken({ id: ownerId, email: owner.email, role: 'super_admin', tenantId: tenantAId });
});

afterAll(async () => {
  await prismaBase.storeMembership.deleteMany({ where: { userId: { in: [ownerId, orphanId] } } });
  await prismaBase.user.deleteMany({ where: { id: { in: [ownerId, orphanId] } } });
  await prismaBase.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId, tenantCId] } } });
  await prismaBase.$disconnect();
});

describe('mintTokens — fail closed', () => {
  it('REFUSES to mint when no active store resolves (403 TENANT_UNRESOLVED, never a null-tenant token)', async () => {
    await expect(
      mintTokens({ id: orphanId, email: `orphan-${SUFFIX}@test.com`, role: 'super_admin', tenantId: null }),
    ).rejects.toMatchObject({ statusCode: 403, errorCode: 'TENANT_UNRESOLVED' });
  });

  it('mints scoped to the default membership when user.tenantId is null but a default store exists', async () => {
    const { tenantId } = await mintTokens({ id: ownerId, email: `owner-${SUFFIX}@test.com`, role: 'super_admin', tenantId: null });
    expect(tenantId).toBe(tenantAId);
  });
});

describe('GET /api/stores', () => {
  it('returns exactly the caller\'s memberships (A and B, not C)', async () => {
    const res = await request(app).get('/api/stores').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.stores.map((s: any) => s.tenantId).sort();
    expect(ids).toEqual([tenantAId, tenantBId].sort());
    const active = res.body.stores.find((s: any) => s.tenantId === tenantAId);
    expect(active.isActive).toBe(true);
  });
});

describe('POST /api/stores/switch', () => {
  it('re-mints a token scoped to an owned store', async () => {
    const res = await request(app).post('/api/stores/switch').set('Authorization', `Bearer ${ownerToken}`).send({ tenantId: tenantBId });
    expect(res.status).toBe(200);
    expect(res.body.activeTenantId).toBe(tenantBId);
    expect(verifyAccessToken(res.body.accessToken).tenantId).toBe(tenantBId);
  });

  it('403s (NOT_A_MEMBER) for a store the caller does not belong to', async () => {
    const res = await request(app).post('/api/stores/switch').set('Authorization', `Bearer ${ownerToken}`).send({ tenantId: tenantCId });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_A_MEMBER');
  });
});
