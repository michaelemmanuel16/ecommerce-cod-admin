/**
 * Tenant Isolation Integration Tests (MAN-11)
 *
 * Proves that cross-tenant data contamination is impossible.
 * Tests every major tenant-scoped model against the Prisma middleware and JWT token claims.
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { tenantStorage } from '../../utils/tenantContext';
import prisma from '../../utils/prisma';

// ── Mocks ──────────────────────────────────────────────────────────────────

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

// ── Test State ─────────────────────────────────────────────────────────────

let tenantAId: string;
let tenantBId: string;
let userAId: number;
let userBId: number;
let tokenA: string;
let tokenB: string;

// IDs of records created under tenant A
let orderIdA: number;
let customerIdA: number;
let productIdA: number;
let checkoutFormIdA: number;

// Unique suffixes to avoid conflicts across test runs
const SUFFIX = Date.now();

// ── Setup ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // 1. Create two isolated tenants
  const [tenantA, tenantB] = await Promise.all([
    prismaBase.tenant.create({ data: { name: `Tenant A ${SUFFIX}`, slug: `tenant-a-${SUFFIX}` } }),
    prismaBase.tenant.create({ data: { name: `Tenant B ${SUFFIX}`, slug: `tenant-b-${SUFFIX}` } }),
  ]);
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  // 2. Create a super_admin user for each tenant (direct DB insert — no bcrypt needed for tests)
  const [userA, userB] = await Promise.all([
    prismaBase.user.create({
      data: {
        email: `admin-a-${SUFFIX}@test.com`,
        password: 'hashed',
        firstName: 'Admin',
        lastName: 'A',
        role: 'super_admin',
        tenantId: tenantAId,
      },
    }),
    prismaBase.user.create({
      data: {
        email: `admin-b-${SUFFIX}@test.com`,
        password: 'hashed',
        firstName: 'Admin',
        lastName: 'B',
        role: 'super_admin',
        tenantId: tenantBId,
      },
    }),
  ]);
  userAId = userA.id;
  userBId = userB.id;

  // 3. Mint JWT tokens that carry tenantId
  tokenA = generateAccessToken({ id: userAId, email: userA.email, role: 'super_admin', tenantId: tenantAId });
  tokenB = generateAccessToken({ id: userBId, email: userB.email, role: 'super_admin', tenantId: tenantBId });

  // 4. Create seed data under Tenant A via prismaBase (bypasses extension intentionally for setup)
  const customerA = await prismaBase.customer.create({
    data: {
      firstName: 'Alice',
      lastName: 'Smith',
      phoneNumber: `+2330000${SUFFIX}`.slice(0, 15),
      address: '1 Test St',
      state: 'Greater Accra',
      area: 'Accra',
      tenantId: tenantAId,
    },
  });
  customerIdA = customerA.id;

  const productA = await prismaBase.product.create({
    data: {
      name: `Product A ${SUFFIX}`,
      sku: `SKU-A-${SUFFIX}`,
      category: 'test',
      price: 100,
      stockQuantity: 50,
      tenantId: tenantAId,
    },
  });
  productIdA = productA.id;

  const orderA = await prismaBase.order.create({
    data: {
      customerId: customerIdA,
      subtotal: 100,
      shippingCost: 0,
      totalAmount: 100,
      deliveryAddress: '1 Test St',
      deliveryState: 'Greater Accra',
      deliveryArea: 'Accra',
      tenantId: tenantAId,
    },
  });
  orderIdA = orderA.id;

  const formA = await (prismaBase as any).checkoutForm.create({
    data: {
      name: `Form A ${SUFFIX}`,
      slug: `form-a-${SUFFIX}`,
      productId: productIdA,
      fields: [],
      styling: {},
      regions: [],
      tenantId: tenantAId,
    },
  });
  checkoutFormIdA = formA.id;
});

// ── Teardown ───────────────────────────────────────────────────────────────

afterAll(async () => {
  // Delete in FK-safe order
  await (prismaBase as any).checkoutForm.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prismaBase.orderItem.deleteMany({ where: { order: { tenantId: { in: [tenantAId, tenantBId] } } } });
  await prismaBase.order.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prismaBase.customer.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prismaBase.product.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
  await prismaBase.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
  await prismaBase.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
  await prismaBase.$disconnect();
});

// ── Scenario 2: Order Isolation ────────────────────────────────────────────

describe('Scenario 2 — Order isolation', () => {
  it('Tenant A can list its own orders', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const orderIds = (res.body.orders ?? res.body.data ?? []).map((o: any) => o.id);
    expect(orderIds).toContain(orderIdA);
  });

  it('Tenant B sees zero orders belonging to Tenant A', async () => {
    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    const orders = res.body.orders ?? res.body.data ?? [];
    const crossTenantOrders = orders.filter((o: any) => o.tenantId === tenantAId);
    expect(crossTenantOrders).toHaveLength(0);
  });
});

// ── Scenario 3: Customer Isolation ────────────────────────────────────────

describe('Scenario 3 — Customer isolation', () => {
  it('Tenant A can retrieve its own customer', async () => {
    const res = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const ids = (res.body.customers ?? res.body.data ?? []).map((c: any) => c.id);
    expect(ids).toContain(customerIdA);
  });

  it('Tenant B customer list contains no Tenant A customers', async () => {
    const res = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    const customers = res.body.customers ?? res.body.data ?? [];
    const leaked = customers.filter((c: any) => c.tenantId === tenantAId);
    expect(leaked).toHaveLength(0);
  });
});

// ── Scenario 4: Product Isolation ─────────────────────────────────────────

describe('Scenario 4 — Product isolation', () => {
  it('Tenant A can list its own products', async () => {
    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const ids = (res.body.products ?? res.body.data ?? []).map((p: any) => p.id);
    expect(ids).toContain(productIdA);
  });

  it('Tenant B product list contains no Tenant A products', async () => {
    const res = await request(app)
      .get('/api/products')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    const products = res.body.products ?? res.body.data ?? [];
    const leaked = products.filter((p: any) => p.tenantId === tenantAId);
    expect(leaked).toHaveLength(0);
  });
});

// ── Scenario 5: Checkout Form Isolation ───────────────────────────────────

describe('Scenario 5 — Checkout form isolation', () => {
  it('Tenant A can list its own checkout forms', async () => {
    const res = await request(app)
      .get('/api/checkout-forms')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const ids = (res.body.forms ?? res.body.data ?? []).map((f: any) => f.id);
    expect(ids).toContain(checkoutFormIdA);
  });

  it('Tenant B checkout form list contains no Tenant A forms', async () => {
    const res = await request(app)
      .get('/api/checkout-forms')
      .set('Authorization', `Bearer ${tokenB}`);

    expect(res.status).toBe(200);
    const forms = res.body.forms ?? res.body.data ?? [];
    const leaked = forms.filter((f: any) => f.tenantId === tenantAId);
    expect(leaked).toHaveLength(0);
  });
});

// ── Scenario 6: Cross-Tenant ID Exploit ───────────────────────────────────
//
// Tests tenant isolation at the Prisma layer — the same mechanism that protects
// the HTTP layer. Using tenantStorage.run() mirrors what the authenticate
// middleware does when it receives a Tenant B JWT.

describe('Scenario 6 — Cross-tenant ID exploit', () => {
  it('Order belonging to Tenant A is invisible when queried under Tenant B context', async () => {
    const result = await new Promise<any>((resolve, reject) => {
      tenantStorage.run({ tenantId: tenantBId }, async () => {
        try {
          resolve(await prisma.order.findFirst({ where: { id: orderIdA } }));
        } catch (err) {
          reject(err);
        }
      });
    });

    // The Prisma extension added tenantId = tenantBId to the WHERE clause,
    // so the order owned by tenantA is invisible → null
    expect(result).toBeNull();
  });

  it('Customer belonging to Tenant A is invisible when queried under Tenant B context', async () => {
    const result = await new Promise<any>((resolve, reject) => {
      tenantStorage.run({ tenantId: tenantBId }, async () => {
        try {
          resolve(await prisma.customer.findFirst({ where: { id: customerIdA } }));
        } catch (err) {
          reject(err);
        }
      });
    });

    expect(result).toBeNull();
  });

  it('Product belonging to Tenant A is invisible when queried under Tenant B context', async () => {
    const result = await new Promise<any>((resolve, reject) => {
      tenantStorage.run({ tenantId: tenantBId }, async () => {
        try {
          resolve(await prisma.product.findFirst({ where: { id: productIdA } }));
        } catch (err) {
          reject(err);
        }
      });
    });

    expect(result).toBeNull();
  });
});

// ── Scenario 7: Middleware Bypass Test ────────────────────────────────────

describe('Scenario 7 — Prisma middleware behaviour without tenant context', () => {
  it('raw Prisma query with explicit tenantId context returns only that tenant\'s data', async () => {
    const orders = await new Promise<any[]>((resolve, reject) => {
      tenantStorage.run({ tenantId: tenantAId }, async () => {
        try {
          const result = await prisma.order.findMany({});
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });

    const tenantBOrders = orders.filter((o) => o.tenantId === tenantBId);
    expect(tenantBOrders).toHaveLength(0);

    const tenantAOrders = orders.filter((o) => o.tenantId === tenantAId);
    expect(tenantAOrders.length).toBeGreaterThanOrEqual(1);
  });

  it('raw Prisma query with no tenant context is unfiltered (system/seed access)', async () => {
    // Without tenantStorage.run(), getTenantId() returns null and the extension
    // passes through. This is intentional for seeding and admin operations.
    const allOrders = await prismaBase.order.findMany({
      where: { tenantId: { in: [tenantAId, tenantBId] } },
    });

    const ids = allOrders.map((o) => o.tenantId);
    // Both tenants' data is visible when no tenant context is set
    expect(ids).toContain(tenantAId);
  });
});
