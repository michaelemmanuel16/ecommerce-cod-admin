/**
 * Identity carve-out for me / logout / refresh (MAN-93)
 *
 * me and logout ran through the tenant-scoped client, so for a null-tenant owner
 * (active store != their null User.tenantId) the reads missed and logout's
 * refresh-token clear silently matched zero rows — logout was a lie. me/logout
 * now use the unscoped identity carve-out; refresh routes through mintTokens.
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken, generateRefreshToken } from '../../utils/jwt';

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
let ownerEmail: string;
let accessToken: string;   // active store = storeId, but owner's User.tenantId is null
let refreshTok: string;

beforeAll(async () => {
  const store = await prismaBase.tenant.create({ data: { name: `S ${SUFFIX}`, slug: `s-${SUFFIX}`, subscriptionStatus: 'active' } });
  storeId = store.id;
  ownerEmail = `id-owner-${SUFFIX}@test.com`;

  const owner = await prismaBase.user.create({
    data: { email: ownerEmail, password: 'x', role: 'super_admin', firstName: 'Id', lastName: 'Owner', tenantId: null },
  });
  ownerId = owner.id;

  await prismaBase.storeMembership.create({ data: { userId: ownerId, tenantId: storeId, role: 'super_admin', isDefault: true } });

  accessToken = generateAccessToken({ id: ownerId, email: ownerEmail, role: 'super_admin', tenantId: storeId });
  refreshTok = generateRefreshToken({ id: ownerId, email: ownerEmail, role: 'super_admin', tenantId: storeId });
  await prismaBase.user.update({ where: { id: ownerId }, data: { refreshToken: refreshTok } });
});

afterAll(async () => {
  await prismaBase.storeMembership.deleteMany({ where: { userId: ownerId } });
  await prismaBase.user.deleteMany({ where: { id: ownerId } });
  await prismaBase.tenant.deleteMany({ where: { id: storeId } });
  await prismaBase.$disconnect();
});

describe('me / logout / refresh identity carve-out (null-tenant owner)', () => {
  it('me resolves the null-tenant owner\'s own row', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(ownerId);
    expect(res.body.user.email).toBe(ownerEmail);
  });

  it('refresh goes through mintTokens and returns a new access token', async () => {
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: refreshTok });
    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
  });

  it('logout clears the refresh token for a null-tenant owner (no silent no-op)', async () => {
    const res = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    const after = await prismaBase.user.findFirst({ where: { id: ownerId }, select: { refreshToken: true } });
    expect(after?.refreshToken).toBeNull();
  });
});
