/**
 * platformAuth owner-resolution + zero-store bootstrap (MAN-92)
 *
 * requirePlatformAdmin resolved the admin's User row through the tenant-scoped
 * (extended) client while the caller's active-store tenant was still in context.
 * An owner in platform mode (User.tenantId = null, holding some other store's
 * active tenant) was therefore not found -> 403, locking owners — including
 * brand-new zero-store owners — out of the provisioning console.
 *
 * Fix: resolve identity through prismaBase (unscoped) BEFORE nullifying tenant
 * context. These tests prove a null-tenant platform admin reaches the console and
 * a non-admin is still forbidden.
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
const ROUTE = '/api/platform/tenants';

let storeId: string;
let adminId: number;
let nonAdminId: number;
let adminToken: string;   // platform admin, User.tenantId = null, token carries another store
let nonAdminToken: string;

beforeAll(async () => {
  const store = await prismaBase.tenant.create({ data: { name: `Store ${SUFFIX}`, slug: `store-${SUFFIX}`, subscriptionStatus: 'active' } });
  storeId = store.id;

  // Owner in platform mode: isPlatformAdmin, but User.tenantId is null.
  const admin = await prismaBase.user.create({
    data: {
      email: `padmin-${SUFFIX}@test.com`, password: 'x', role: 'super_admin',
      firstName: 'Plat', lastName: 'Admin', tenantId: null, isPlatformAdmin: true,
    },
  });
  adminId = admin.id;

  const nonAdmin = await prismaBase.user.create({
    data: {
      email: `nonadmin-${SUFFIX}@test.com`, password: 'x', role: 'super_admin',
      firstName: 'Non', lastName: 'Admin', tenantId: storeId, isPlatformAdmin: false,
    },
  });
  nonAdminId = nonAdmin.id;

  // The admin's token carries an active store even though their User row is
  // null-tenant — this is exactly what the scoped lookup used to trip on.
  adminToken = generateAccessToken({ id: adminId, email: admin.email, role: 'super_admin', tenantId: storeId });
  nonAdminToken = generateAccessToken({ id: nonAdminId, email: nonAdmin.email, role: 'super_admin', tenantId: storeId });
});

afterAll(async () => {
  await prismaBase.user.deleteMany({ where: { id: { in: [adminId, nonAdminId] } } });
  await prismaBase.tenant.deleteMany({ where: { id: storeId } });
  await prismaBase.$disconnect();
});

describe('requirePlatformAdmin (owner-resolution + zero-store bootstrap)', () => {
  it('lets a null-tenant platform admin reach the console (not a 403 lockout)', async () => {
    const res = await request(app).get(ROUTE).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
  });

  it('still forbids a non-platform-admin (403)', async () => {
    const res = await request(app).get(ROUTE).set('Authorization', `Bearer ${nonAdminToken}`);
    expect(res.status).toBe(403);
  });
});
