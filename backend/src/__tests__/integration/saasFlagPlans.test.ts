/**
 * M3-T26 (COD-24): SaaS signup flag, platform plans, billing data from the plans table.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { bearer, superAdminToken } from './helpers/superAdminToken';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
let tenantA: Awaited<ReturnType<typeof createTenant>>;
let tenantB: Awaited<ReturnType<typeof createTenant>>;
let tokenA: string;
let tokenB: string;
let platformToken: string;

const body = () => ({ companyName: `Flag Co ${SUFFIX}`, adminEmail: `flag-${SUFFIX}@codadmin.test`, adminPassword: 'Passw0rd!test', adminName: 'Flag Admin' });

beforeAll(async () => {
  tenantA = await createTenant('Flag A');
  tenantB = await createTenant('Flag B');
  tokenA = await superAdminToken(tenantA.id, tenantA.slug, 'flag-owner');
  tokenB = await superAdminToken(tenantB.id, tenantB.slug, 'flag-owner');
  const admin = await prismaBase.user.create({
    data: { email: `flag-platform-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Plat', lastName: 'Form', role: 'super_admin', isPlatformAdmin: true, tenantId: null },
  });
  platformToken = generateAccessToken({ id: admin.id, email: admin.email, role: 'super_admin', tenantId: null, isPlatformAdmin: true } as any);
}, 120_000);

afterAll(async () => {
  delete process.env.SAAS_SIGNUP_ENABLED;
  await prismaBase.user.deleteMany({ where: { email: { startsWith: 'flag-' } } });
  await deleteTenantRows([tenantA.id, tenantB.id]);
  await prismaBase.$disconnect();
});

describe('SAAS_SIGNUP_ENABLED', () => {
  it('flag unset: register-tenant and the subscription callback return 404', async () => {
    delete process.env.SAAS_SIGNUP_ENABLED;
    expect((await request(app).post('/api/auth/register-tenant').send(body())).status).toBe(404);
    expect((await request(app).get('/api/billing/verify-subscription/ref_1').set(bearer(tokenA))).status).toBe(404);
    expect(await prismaBase.user.findUnique({ where: { email: body().adminEmail } })).toBeNull();
  });

  it('flag false: still 404', async () => {
    process.env.SAAS_SIGNUP_ENABLED = 'false';
    expect((await request(app).post('/api/auth/register-tenant').send(body())).status).toBe(404);
  });

  it('flag on: register-tenant works (201) and the callback reaches its handler', async () => {
    process.env.SAAS_SIGNUP_ENABLED = 'true';
    const res = await request(app).post('/api/auth/register-tenant').send(body());
    expect(res.status).toBe(201);
    await deleteTenantRows([res.body.tenant.id]);
    expect((await request(app).get('/api/billing/verify-subscription/ref_1').set(bearer(tokenA))).status).not.toBe(404);
  });
});

describe('plans', () => {
  it('GET /api/platform/plans returns the active plans plus free, from the table', async () => {
    const res = await request(app).get('/api/platform/plans').set(bearer(platformToken));
    expect(res.status).toBe(200);
    const names = res.body.plans.map((p: any) => p.name);
    expect(names).toEqual(['free', 'growth', 'scale', 'enterprise']);
    const rows = await prismaBase.plan.findMany({ where: { name: { in: names } } });
    const growth = res.body.plans.find((p: any) => p.name === 'growth');
    const growthRow = rows.find((r) => r.name === 'growth')!;
    expect(Number(growth.priceNGN)).toBe(Number(growthRow.priceNGN));
    expect(growth.maxOrders).toBe(growthRow.maxOrders);
    expect(growth.maxUsers).toBe(growthRow.maxUsers);
    expect(names).not.toContain('starter');
    expect(names).not.toContain('pro');
  });

  it('GET /api/platform/plans is for platform admins only', async () => {
    expect((await request(app).get('/api/platform/plans').set(bearer(tokenA))).status).toBe(403);
    expect((await request(app).get('/api/platform/plans')).status).toBe(401);
  });

  it('billing reads the plan numbers from the plans table, and the pending plan feeds the banner', async () => {
    const growth = (await prismaBase.plan.findUnique({ where: { name: 'growth' } }))!;
    await prismaBase.tenant.update({ where: { id: tenantA.id }, data: { currentPlanId: growth.id, subscriptionStatus: 'pending' } });
    const res = await request(app).get('/api/billing/subscription').set(bearer(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.plan.maxOrders).toBe(growth.maxOrders);
    expect(Number(res.body.nextChargeAmount)).toBe(Number(growth.priceNGN));
    expect(res.body.usage).toMatchObject({ maxOrders: growth.maxOrders, maxUsers: growth.maxUsers });
    expect(res.body.pendingPlan).toMatchObject({ name: 'growth', displayName: growth.displayName, status: 'pending' });
    expect(Number(res.body.pendingPlan.priceNGN)).toBe(Number(growth.priceNGN));

    // Change the row: the response follows it (no number lives in code).
    await prismaBase.plan.update({ where: { id: growth.id }, data: { maxOrders: 1234 } });
    try {
      const again = await request(app).get('/api/billing/subscription').set(bearer(tokenA));
      expect(again.body.usage.maxOrders).toBe(1234);
    } finally {
      await prismaBase.plan.update({ where: { id: growth.id }, data: { maxOrders: growth.maxOrders } });
    }

    // Two tenants: B has no plan and no banner.
    const other = await request(app).get('/api/billing/subscription').set(bearer(tokenB));
    expect(other.body.pendingPlan).toBeNull();
    expect(other.body.plan).toBeNull();
  });

  it('GET /api/billing/plans lists the active plans', async () => {
    const res = await request(app).get('/api/billing/plans');
    expect(res.body.plans.map((p: any) => p.name).sort()).toEqual(['enterprise', 'growth', 'scale']);
  });
});
