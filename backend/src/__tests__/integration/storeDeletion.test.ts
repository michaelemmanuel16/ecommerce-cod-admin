/**
 * Split deletion: delete-this-store vs delete-all-account (MAN-98)
 *
 * DELETE /api/stores/:id removes only that store (owner + other stores survive),
 * is owner-scoped, needs the store name + password, and refuses the last store.
 * DELETE /api/auth/delete-account removes every OWNED store then the owner last.
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import bcrypt from 'bcrypt';
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
const PASSWORD = 'secret123';

let storeAId: string; let storeBId: string; let storeAName: string;
let ownerId: number; let strangerId: number;
let ownerToken: string; let strangerToken: string;

beforeAll(async () => {
  const hash = await bcrypt.hash(PASSWORD, 10);
  const a = await prismaBase.tenant.create({ data: { name: `Store A ${SUFFIX}`, slug: `a-${SUFFIX}`, subscriptionStatus: 'active' } });
  const b = await prismaBase.tenant.create({ data: { name: `Store B ${SUFFIX}`, slug: `b-${SUFFIX}`, subscriptionStatus: 'active' } });
  storeAId = a.id; storeBId = b.id; storeAName = a.name;

  const owner = await prismaBase.user.create({ data: { email: `del-owner-${SUFFIX}@t.com`, password: hash, role: 'super_admin', firstName: 'Del', lastName: 'Owner', tenantId: null } });
  ownerId = owner.id;
  await prismaBase.tenant.update({ where: { id: storeAId }, data: { ownerUserId: ownerId } });
  await prismaBase.tenant.update({ where: { id: storeBId }, data: { ownerUserId: ownerId } });
  await prismaBase.storeMembership.createMany({ data: [
    { userId: ownerId, tenantId: storeAId, role: 'super_admin', isDefault: true },
    { userId: ownerId, tenantId: storeBId, role: 'super_admin', isDefault: false },
  ]});

  const stranger = await prismaBase.user.create({ data: { email: `del-stranger-${SUFFIX}@t.com`, password: hash, role: 'super_admin', firstName: 'Str', lastName: 'Anger', tenantId: storeBId } });
  strangerId = stranger.id;

  ownerToken = generateAccessToken({ id: ownerId, email: owner.email, role: 'super_admin', tenantId: storeAId });
  strangerToken = generateAccessToken({ id: strangerId, email: stranger.email, role: 'super_admin', tenantId: storeBId });
});

afterAll(async () => {
  await prismaBase.storeMembership.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
  await prismaBase.tenant.updateMany({ where: { id: { in: [storeAId, storeBId] } }, data: { ownerUserId: null } });
  await prismaBase.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
  await prismaBase.tenant.deleteMany({ where: { id: { in: [storeAId, storeBId] } } });
  await prismaBase.$disconnect();
});

describe('DELETE /api/stores/:id (delete-this-store)', () => {
  it('rejects a wrong password (401) and does not delete', async () => {
    const res = await request(app).delete(`/api/stores/${storeAId}`).set('Authorization', `Bearer ${ownerToken}`).send({ password: 'wrong', confirmName: storeAName });
    expect(res.status).toBe(401);
    expect(await prismaBase.tenant.findUnique({ where: { id: storeAId } })).not.toBeNull();
  });

  it('rejects a non-matching store name (400)', async () => {
    const res = await request(app).delete(`/api/stores/${storeAId}`).set('Authorization', `Bearer ${ownerToken}`).send({ password: PASSWORD, confirmName: 'wrong name' });
    expect(res.status).toBe(400);
  });

  it('rejects a non-owner (403)', async () => {
    const res = await request(app).delete(`/api/stores/${storeAId}`).set('Authorization', `Bearer ${strangerToken}`).send({ password: PASSWORD, confirmName: storeAName });
    expect(res.status).toBe(403);
  });

  it('deletes only the target store; owner and other store survive', async () => {
    const res = await request(app).delete(`/api/stores/${storeAId}`).set('Authorization', `Bearer ${ownerToken}`).send({ password: PASSWORD, confirmName: storeAName });
    expect(res.status).toBe(200);
    expect(await prismaBase.tenant.findUnique({ where: { id: storeAId } })).toBeNull();
    expect(await prismaBase.tenant.findUnique({ where: { id: storeBId } })).not.toBeNull();
    expect(await prismaBase.user.findFirst({ where: { id: ownerId } })).not.toBeNull();
  });

  it('refuses to delete the owner\'s only remaining store (400)', async () => {
    const bName = (await prismaBase.tenant.findUnique({ where: { id: storeBId }, select: { name: true } }))!.name;
    const res = await request(app).delete(`/api/stores/${storeBId}`).set('Authorization', `Bearer ${ownerToken}`).send({ password: PASSWORD, confirmName: bName });
    expect(res.status).toBe(400);
    expect(await prismaBase.tenant.findUnique({ where: { id: storeBId } })).not.toBeNull();
  });
});

describe('DELETE /api/auth/delete-account (delete-all)', () => {
  it('removes every owned store and the owner last', async () => {
    const res = await request(app).delete('/api/auth/delete-account').set('Authorization', `Bearer ${ownerToken}`).send({ password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await prismaBase.tenant.findUnique({ where: { id: storeBId } })).toBeNull();
    expect(await prismaBase.user.findFirst({ where: { id: ownerId } })).toBeNull();
  });
});
