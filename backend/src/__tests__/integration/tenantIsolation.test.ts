/**
 * Tenant Isolation Integration Tests (MAN-11, rebuilt on the two-tenant helper in M0-T27)
 *
 * Proves that cross-tenant data contamination is impossible.
 * Tests every major tenant-scoped model against the Prisma middleware and JWT token claims.
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { TenantContextMissing, withoutTenant } from '../../utils/tenantContext';
import { createTwoTenants, asTenant, TwoTenants } from './helpers/twoTenants';

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
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

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

// ── Scenario 2: Order Isolation ────────────────────────────────────────────

describe('Scenario 2 — Order isolation', () => {
  it('Tenant A can list its own orders', async () => {
    const res = await get('/api/orders', a.users.admin.token);

    expect(res.status).toBe(200);
    const orderIds = (res.body.orders ?? res.body.data ?? []).map((o: any) => o.id);
    expect(orderIds).toContain(a.ids.order);
  });

  it('Tenant B sees zero orders belonging to Tenant A', async () => {
    const res = await get('/api/orders', b.users.admin.token);

    expect(res.status).toBe(200);
    const orders = res.body.orders ?? res.body.data ?? [];
    expect(orders.map((o: any) => o.id)).toContain(b.ids.order);
    expect(orders.filter((o: any) => o.tenantId === a.id || o.id === a.ids.order)).toHaveLength(0);
  });
});

// ── Scenario 3: Customer Isolation ────────────────────────────────────────

describe('Scenario 3 — Customer isolation', () => {
  it('Tenant A can retrieve its own customer', async () => {
    const res = await get('/api/customers', a.users.admin.token);

    expect(res.status).toBe(200);
    const ids = (res.body.customers ?? res.body.data ?? []).map((c: any) => c.id);
    expect(ids).toContain(a.ids.customer);
  });

  it('Tenant B customer list contains no Tenant A customers', async () => {
    const res = await get('/api/customers', b.users.admin.token);

    expect(res.status).toBe(200);
    const customers = res.body.customers ?? res.body.data ?? [];
    expect(customers.filter((c: any) => c.tenantId === a.id || c.id === a.ids.customer)).toHaveLength(0);
  });
});

// ── Scenario 4: Product Isolation ─────────────────────────────────────────

describe('Scenario 4 — Product isolation', () => {
  it('Tenant A can list its own products', async () => {
    const res = await get('/api/products', a.users.admin.token);

    expect(res.status).toBe(200);
    const ids = (res.body.products ?? res.body.data ?? []).map((p: any) => p.id);
    expect(ids).toContain(a.ids.product);
  });

  it('Tenant B product list contains no Tenant A products', async () => {
    const res = await get('/api/products', b.users.admin.token);

    expect(res.status).toBe(200);
    const products = res.body.products ?? res.body.data ?? [];
    expect(products.filter((p: any) => p.tenantId === a.id || p.id === a.ids.product)).toHaveLength(0);
  });
});

// ── Scenario 5: Checkout Form Isolation ───────────────────────────────────

describe('Scenario 5 — Checkout form isolation', () => {
  it('Tenant A can list its own checkout forms', async () => {
    const res = await get('/api/checkout-forms', a.users.admin.token);

    expect(res.status).toBe(200);
    const ids = (res.body.forms ?? res.body.data ?? []).map((f: any) => f.id);
    expect(ids).toContain(a.ids.checkoutForm);
  });

  it('Tenant B checkout form list contains no Tenant A forms', async () => {
    const res = await get('/api/checkout-forms', b.users.admin.token);

    expect(res.status).toBe(200);
    const forms = res.body.forms ?? res.body.data ?? [];
    expect(forms.filter((f: any) => f.tenantId === a.id || f.id === a.ids.checkoutForm)).toHaveLength(0);
  });
});

// ── Scenario 6: Cross-Tenant ID Exploit ───────────────────────────────────
//
// Tests tenant isolation at the Prisma layer — the same mechanism that protects
// the HTTP layer. asTenant mirrors what the authenticate middleware does when it
// receives a Tenant B JWT.

describe('Scenario 6 — Cross-tenant ID exploit', () => {
  it('Order belonging to Tenant A is invisible when queried under Tenant B context', async () => {
    // The Prisma extension adds tenantId = B to the WHERE clause, so A's order is invisible
    expect(await asTenant(b, () => prisma.order.findFirst({ where: { id: a.ids.order } }))).toBeNull();
  });

  it('Customer belonging to Tenant A is invisible when queried under Tenant B context', async () => {
    expect(await asTenant(b, () => prisma.customer.findFirst({ where: { id: a.ids.customer } }))).toBeNull();
  });

  it('Product belonging to Tenant A is invisible when queried under Tenant B context', async () => {
    expect(await asTenant(b, () => prisma.product.findFirst({ where: { id: a.ids.product } }))).toBeNull();
  });

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
    const orders = await asTenant(a, () => prisma.order.findMany({}));

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
// currency. The public route now needs a tenant or form slug and is 404 without one.
// The helper gives A GHS and B NGN.

describe('Scenario 8 — Per-tenant currency config', () => {
  it('authenticated config route returns Tenant A currency (GHS)', async () => {
    const res = await get('/api/admin/config/me', a.users.admin.token);

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('GHS');
  });

  it('authenticated config route returns Tenant B currency (NGN)', async () => {
    const res = await get('/api/admin/config/me', b.users.admin.token);

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('NGN');
  });

  it('unauthenticated public config without a slug is 404 (no tenant currency leak)', async () => {
    const res = await request(app).get('/api/admin/config');

    expect(res.status).toBe(404);
    expect(res.body.currency).toBeUndefined();
  });
});
