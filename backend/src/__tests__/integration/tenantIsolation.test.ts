/**
 * Tenant Isolation Integration Tests (MAN-11, rebuilt on the two-tenant helper in M0-T27)
 *
 * Proves that cross-tenant data contamination is impossible.
 * Tests every major tenant-scoped model against the Prisma middleware and JWT token claims.
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { TenantContextMissing, runInTenant, withoutTenant } from '../../utils/tenantContext';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
let a: TwoTenants['a'];
let b: TwoTenants['b'];

beforeAll(async () => {
  pair = await createTwoTenants('isolation');
  a = pair.a;
  b = pair.b;
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

const get = (path: string, token: string) =>
  request(app).get(path).set('Authorization', `Bearer ${token}`);

// ── Scenarios 2-5: Order, customer, product and checkout form isolation ───

// [label, list path, key of the rows in the body, key in `ids`]
const LISTS: Array<[string, string, string, string]> = [
  ['orders', '/api/orders', 'orders', 'order'],
  ['customers', '/api/customers', 'customers', 'customer'],
  ['products', '/api/products', 'products', 'product'],
  ['checkout forms', '/api/checkout-forms', 'forms', 'checkoutForm'],
];
const rowsOf = (body: any, bodyKey: string): any[] => body[bodyKey] ?? body.data ?? [];

describe('Scenarios 2-5 — list isolation', () => {
  it.each(LISTS)('Tenant A can list its own %s', async (_label, path, bodyKey, idKey) => {
    const res = await get(path, a.users.admin.token);

    expect(res.status).toBe(200);
    expect(rowsOf(res.body, bodyKey).map((r) => r.id)).toContain(a.ids[idKey]);
  });

  it.each(LISTS)('Tenant B %s list contains no Tenant A rows', async (_label, path, bodyKey, idKey) => {
    const res = await get(path, b.users.admin.token);

    expect(res.status).toBe(200);
    const rows = rowsOf(res.body, bodyKey);
    expect(rows.map((r) => r.id)).toContain(b.ids[idKey]);
    expect(rows.filter((r) => r.tenantId === a.id || r.id === a.ids[idKey])).toHaveLength(0);
  });
});

// ── Scenario 6: Cross-Tenant ID Exploit ───────────────────────────────────
//
// The Prisma-layer half (A's order, customer and product are invisible under B's
// context) is asserted for every model by twoTenantModels.test.ts, in the A -> B
// direction: "orders", "customers" and "products" (findFirst / findUnique by the
// other tenant's id is null).

describe('Scenario 6 — Cross-tenant ID exploit', () => {
  it('a Tenant B token cannot fetch Tenant A order, customer or product by id over HTTP', async () => {
    for (const path of [`/api/orders/${a.ids.order}`, `/api/customers/${a.ids.customer}`, `/api/products/${a.ids.product}`]) {
      const res = await get(path, b.users.admin.token);
      expect(res.status).toBe(404);
    }
  });
});

// ── Scenario 7: Middleware Bypass Test ────────────────────────────────────

describe('Scenario 7 — Prisma middleware behaviour without tenant context', () => {
  it("raw Prisma query with explicit tenantId context returns only that tenant's data", async () => {
    const orders = await runInTenant(a.id, () => prisma.order.findMany({}));

    expect(orders.filter((o) => o.tenantId === b.id)).toHaveLength(0);
    expect(orders.filter((o) => o.tenantId === a.id).length).toBeGreaterThanOrEqual(1);
  });

  it('Prisma query with no tenant context throws TenantContextMissing (fail-closed)', async () => {
    await expect(prisma.order.findMany({})).rejects.toThrow(TenantContextMissing);
  });

  it('inside withoutTenant the same query runs unscoped and sees both tenants', async () => {
    const allOrders = await withoutTenant('test', () =>
      prisma.order.findMany({ where: { tenantId: { in: [a.id, b.id] } } })
    );
    const tenantIds = allOrders.map((o) => o.tenantId);
    expect(tenantIds).toContain(a.id);
    expect(tenantIds).toContain(b.id);
  });
});

// ── Scenario 8: Per-tenant currency config (Financial "$" bug) ─────────────
//
// Regression for the bug where the admin UI rendered "$" even though the tenant
// had saved GHS: the frontend config store read the UNauthenticated
// /api/admin/config, which carries no tenant context and therefore returned the
// global (USD) SystemConfig row. The authenticated /api/admin/config/me route
// resolves the caller's tenant from the JWT, so each tenant gets its own
// currency. The helper gives A GHS and B NGN. The public route without a slug
// is 404: asserted in twoTenantHttp.test.ts, "no slug and an unknown slug are 404".

describe('Scenario 8 — Per-tenant currency config', () => {
  it.each([['A', 'GHS'], ['B', 'NGN']] as const)('authenticated config route returns Tenant %s currency (%s)', async (side, currency) => {
    const res = await get('/api/admin/config/me', (side === 'A' ? a : b).users.admin.token);

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe(currency);
  });
});
