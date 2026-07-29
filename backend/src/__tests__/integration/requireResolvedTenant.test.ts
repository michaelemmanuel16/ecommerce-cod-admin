/**
 * Fail-closed tenant guard — acceptance tests (MAN-88 / MSL-C1/E1)
 *
 * The Prisma tenant-scoping extension FAILS OPEN on a null tenant context, so
 * these tests are the foundation gate: an authed request with an unresolved
 * active store must be REJECTED (403), never allowed through to unscoped data.
 * A pending/non-active store must be blocked at the API (402), not just in UI.
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({
    to: jest.fn(() => ({ emit: jest.fn() })),
    emit: jest.fn(),
  })),
  hasSocketInstance: jest.fn(() => true),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const SUFFIX = Date.now();

let activeTenantId: string;
let pendingTenantId: string;
let activeUserId: number;
let pendingUserId: number;

let tokenActive: string;   // valid JWT, tenantId = an ACTIVE store
let tokenNull: string;     // valid JWT, tenantId = null (unresolved active store)
let tokenPending: string;  // valid JWT, tenantId = a NON-active store

// A tenant-scoped data route protected by requireResolvedTenant.
const GUARDED_ROUTE = '/api/customers';

beforeAll(async () => {
  const activeTenant = await prismaBase.tenant.create({
    data: { name: `Active ${SUFFIX}`, slug: `active-${SUFFIX}`, subscriptionStatus: 'active' },
  });
  const pendingTenant = await prismaBase.tenant.create({
    data: { name: `Pending ${SUFFIX}`, slug: `pending-${SUFFIX}`, subscriptionStatus: 'past_due' },
  });
  activeTenantId = activeTenant.id;
  pendingTenantId = pendingTenant.id;

  const activeUser = await prismaBase.user.create({
    data: {
      email: `active-${SUFFIX}@test.com`, password: 'x', role: 'super_admin',
      firstName: 'Active', lastName: 'Owner', tenantId: activeTenantId,
    },
  });
  const pendingUser = await prismaBase.user.create({
    data: {
      email: `pending-${SUFFIX}@test.com`, password: 'x', role: 'super_admin',
      firstName: 'Pending', lastName: 'Owner', tenantId: pendingTenantId,
    },
  });
  activeUserId = activeUser.id;
  pendingUserId = pendingUser.id;

  tokenActive = generateAccessToken({ id: activeUserId, email: activeUser.email, role: 'super_admin', tenantId: activeTenantId });
  tokenNull = generateAccessToken({ id: activeUserId, email: activeUser.email, role: 'super_admin', tenantId: null as any });
  tokenPending = generateAccessToken({ id: pendingUserId, email: pendingUser.email, role: 'super_admin', tenantId: pendingTenantId });
});

afterAll(async () => {
  await prismaBase.user.deleteMany({ where: { id: { in: [activeUserId, pendingUserId] } } });
  await prismaBase.tenant.deleteMany({ where: { id: { in: [activeTenantId, pendingTenantId] } } });
  await prismaBase.$disconnect();
});

describe('requireResolvedTenant (fail-closed foundation gate)', () => {
  it('REJECTS an authed request with an unresolved active store — 403, not open access', async () => {
    const res = await request(app).get(GUARDED_ROUTE).set('Authorization', `Bearer ${tokenNull}`);
    // The critical assertion: null tenant context must NOT fall through to 200.
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('TENANT_UNRESOLVED');
  });

  it('BLOCKS a non-active store at the API — 402, not just hidden in the UI', async () => {
    const res = await request(app).get(GUARDED_ROUTE).set('Authorization', `Bearer ${tokenPending}`);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('ALLOWS an authed request with a resolved, active store (positive control)', async () => {
    const res = await request(app).get(GUARDED_ROUTE).set('Authorization', `Bearer ${tokenActive}`);
    expect(res.status).toBe(200);
  });
});
