/**
 * M3-T08 (COD-22): GET /api/search?q= for the command palette (F-105).
 * 10,000 seeded orders: p95 under 400 ms (the timing is printed). Phone in any format finds the same customer.
 * Row scope (rep), permission filter and two-tenant checks.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { clearPermissionsCache } from '../../middleware/auth';
import { classifyQuery } from '../../services/searchService';
import { createTenant, createTwoTenants, deleteTenantRows, TwoTenants } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

jest.setTimeout(300_000);

const SUFFIX = Date.now();
const ORDERS = 10_000;
const CUSTOMERS = 8_000;
const FIRST = ['Akosua', 'Kwame', 'Abena', 'Kofi', 'Esi', 'Yaw', 'Ama', 'Kojo', 'Efua', 'Nana', 'Adwoa', 'Kwesi', 'Afia', 'Yaa', 'Fiifi'];
const LAST = ['Mensah', 'Owusu', 'Boateng', 'Asante', 'Appiah', 'Badu', 'Amoah', 'Darko', 'Osei', 'Agyei', 'Tetteh', 'Quaye', 'Addo'];

let perfTenantId: string;
let perfToken: string;
let pair: TwoTenants;
let abenaId: number;
let firstOrderId: number;

const search = (token: string, q: string) => request(app).get('/api/search').query({ q }).set(bearer(token));
const orderData = (tenantId: string, customerId: number, extra: Record<string, unknown> = {}) => ({
  customerId, status: 'pending_confirmation' as const, subtotal: 10, totalAmount: 10, codAmount: 10, tenantId,
  deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra', ...extra,
});

beforeAll(async () => {
  perfTenantId = (await createTenant('Search Perf')).id;
  const owner = await prismaBase.user.create({
    data: { email: `search-owner-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Owner', lastName: 'S', role: 'super_admin', tenantId: perfTenantId },
  });
  perfToken = generateAccessToken({ id: owner.id, email: owner.email, role: 'super_admin', tenantId: perfTenantId });

  await prismaBase.customer.createMany({
    data: Array.from({ length: CUSTOMERS }, (_, i) => ({
      firstName: FIRST[i % FIRST.length], lastName: LAST[Math.floor(i / FIRST.length) % LAST.length] + (i >> 8),
      phoneNumber: `+23324${String(1_000_000 + i).padStart(7, '0')}`, address: `${i % 90} Road`, state: 'Greater Accra', area: 'Accra', tenantId: perfTenantId,
    })),
  });
  // The customer the phone tests look for, and one saved before phone normalization (old local format).
  abenaId = (await prismaBase.customer.create({
    data: { firstName: 'Abena', lastName: 'Zzowusu', phoneNumber: '+233245550103', address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId: perfTenantId },
  })).id;
  await prismaBase.customer.create({
    data: { firstName: 'Legacy', lastName: 'Zzphone', phoneNumber: '0245550104', address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId: perfTenantId },
  });
  const ids = (await prismaBase.customer.findMany({ where: { tenantId: perfTenantId }, select: { id: true } })).map((c) => c.id);
  await prismaBase.order.createMany({
    data: Array.from({ length: ORDERS }, (_, i) => orderData(perfTenantId, ids[i % ids.length])) as any,
  });
  firstOrderId = (await prismaBase.order.findFirstOrThrow({ where: { tenantId: perfTenantId }, orderBy: { id: 'asc' } })).id;
  await prismaBase.order.create({ data: orderData(perfTenantId, abenaId) as any });
  await prismaBase.$executeRawUnsafe('ANALYZE orders'); await prismaBase.$executeRawUnsafe('ANALYZE customers');

  pair = await createTwoTenants('searchapi');
}, 300_000);

afterAll(async () => {
  await pair.cleanup();
  await deleteTenantRows([perfTenantId]);
  await prismaBase.$disconnect();
});

describe('classifyQuery', () => {
  it('# means order number only', () => {
    expect(classifyQuery('#23001')).toEqual({ orderId: 23001, phone: [], nameWords: [] });
  });
  it('a short digit run is an order number and a phone start', () => {
    const q = classifyQuery('23001');
    expect(q.orderId).toBe(23001);
    expect(q.phone.length).toBeGreaterThan(0);
  });
  it('7 or more digits is a phone, not an order number', () => {
    expect(classifyQuery('0245550103').orderId).toBeNull();
    expect(classifyQuery('+233 24 555 0103').orderId).toBeNull();
  });
  it('words are a name', () => {
    expect(classifyQuery('Abena Owusu')).toMatchObject({ orderId: null, phone: [], nameWords: ['Abena', 'Owusu'] });
  });
});

describe('GET /api/search', () => {
  it('401 with no token; empty lists for a query under 2 characters', async () => {
    expect((await request(app).get('/api/search').query({ q: 'abe' })).status).toBe(401);
    expect((await search(perfToken, 'a')).body).toEqual({ orders: [], customers: [] });
    expect((await request(app).get('/api/search').set(bearer(perfToken))).body).toEqual({ orders: [], customers: [] });
  });

  it('phone 0245550103 and +233245550103 find the same customer', async () => {
    for (const q of ['0245550103', '+233245550103', '233245550103', '024 555 0103', '+233 24 555 0103']) {
      const res = await search(perfToken, q);
      expect(res.status).toBe(200);
      expect(res.body.customers.map((c: any) => c.id)).toEqual([abenaId]);
      expect(res.body.orders.length).toBeGreaterThan(0);
      expect(res.body.orders.every((o: any) => o.customer.id === abenaId)).toBe(true);
    }
  });

  it('finds a customer stored in the old local phone format', async () => {
    for (const q of ['0245550104', '+233245550104']) {
      const res = await search(perfToken, q);
      expect(res.body.customers.map((c: any) => c.lastName)).toEqual(['Zzphone']);
    }
  });

  it('order number with or without #', async () => {
    for (const q of [`#${firstOrderId}`, String(firstOrderId)]) {
      const res = await search(perfToken, q);
      expect(res.body.orders.map((o: any) => o.id)).toContain(firstOrderId);
    }
    const hashed = await search(perfToken, `#${firstOrderId}`);
    expect(hashed.body.orders.map((o: any) => o.id)).toEqual([firstOrderId]);
    expect(hashed.body.customers).toEqual([]);
  });

  it('name search: partial, any case, two words', async () => {
    for (const q of ['zzowu', 'ZZOWUSU', 'abena zzowusu', 'Zzowusu Abena']) {
      const res = await search(perfToken, q);
      expect(res.body.customers.map((c: any) => c.id)).toEqual([abenaId]);
    }
  });

  it('returns at most 5 of each, with money as a string', async () => {
    const res = await search(perfToken, 'Akosua');
    expect(res.body.orders).toHaveLength(5);
    expect(res.body.customers).toHaveLength(5);
    expect(res.body.orders[0]).toMatchObject({ status: 'pending_confirmation', totalAmount: '10.00' });
    expect(Object.keys(res.body.orders[0]).sort()).toEqual(['createdAt', 'customer', 'id', 'status', 'totalAmount']);
  });

  it(`p95 under 400 ms on ${ORDERS} orders`, async () => {
    const queries = [
      'Akosua', 'Kwame Mensah', 'zzowu', 'owusu', 'Abena Asante', 'mens', '0245550103', '+233245550103', '024 100 0500',
      '0241000500', '+233241003000', '2410', '#5000', String(firstOrderId + 4000), `#${firstOrderId + 9000}`, 'Efua Boateng3', 'nana', 'xyzzy',
    ];
    await search(perfToken, 'warmup');
    const times: number[] = [];
    for (let round = 0; round < 4; round++) {
      for (const q of queries) {
        const t0 = process.hrtime.bigint();
        const res = await search(perfToken, q);
        times.push(Number(process.hrtime.bigint() - t0) / 1e6);
        expect(res.status).toBe(200);
      }
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1];
    const slowest = times[times.length - 1];
    // eslint-disable-next-line no-console
    console.log(`SEARCH TIMING on ${ORDERS} orders: ${times.length} requests, median ${times[times.length >> 1].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${slowest.toFixed(1)} ms`);
    expect(p95).toBeLessThan(400);
  });
});

describe('row scope, permission filter, tenants', () => {
  it('two tenants: A never finds B and the reverse', async () => {
    const a = await search(pair.a.users.admin.token, pair.a.marker);
    expect(a.body.customers.map((c: any) => c.id)).toEqual([pair.a.ids.customer]);
    const aByPhone = await search(pair.a.users.admin.token, pair.b.phone);
    expect(aByPhone.body).toEqual({ orders: [], customers: [] });
    const aByB = await search(pair.a.users.admin.token, pair.b.marker);
    expect(aByB.body).toEqual({ orders: [], customers: [] });
    expect((await search(pair.b.users.admin.token, pair.b.phone)).body.customers.map((c: any) => c.id)).toEqual([pair.b.ids.customer]);
    // order number of A, asked in B
    expect((await search(pair.b.users.admin.token, `#${pair.a.ids.order}`)).body.orders).toEqual([]);
    expect((await search(pair.a.users.admin.token, `#${pair.a.ids.order}`)).body.orders.map((o: any) => o.id)).toEqual([pair.a.ids.order]);
  });

  it('a call rep finds only own orders and the customers of those orders', async () => {
    const other = await prismaBase.customer.create({
      data: { firstName: `Other${SUFFIX}`, lastName: 'Buyer', phoneNumber: '+233249990001', address: '2 St', state: 'Greater Accra', area: 'Accra', tenantId: pair.a.id },
    });
    const otherOrder = await prismaBase.order.create({ data: orderData(pair.a.id, other.id) as any }); // no rep
    const rep = pair.a.users.salesRep;
    const own = await search(rep.token, pair.a.marker);
    expect(own.body.orders.map((o: any) => o.id)).toEqual([pair.a.ids.order]);
    expect(own.body.customers.map((c: any) => c.id)).toEqual([pair.a.ids.customer]);
    const notMine = await search(rep.token, `Other${SUFFIX}`);
    expect(notMine.body).toEqual({ orders: [], customers: [] });
    expect((await search(rep.token, `#${otherOrder.id}`)).body.orders).toEqual([]);
    // the admin sees both
    const admin = await search(pair.a.users.admin.token, `Other${SUFFIX}`);
    expect(admin.body.orders.map((o: any) => o.id)).toEqual([otherOrder.id]);
    expect(admin.body.customers.map((c: any) => c.id)).toEqual([other.id]);
  });

  it('results follow orders:view and customers:view', async () => {
    const rep = pair.a.users.salesRep;
    const saved = (resources: Record<string, string[]>) =>
      prismaBase.systemConfig.updateMany({ where: { tenantId: pair.a.id }, data: { rolePermissions: { sales_rep: resources } as any } });

    await saved({ customers: [] });
    clearPermissionsCache();
    let res = await search(rep.token, pair.a.marker);
    expect(res.body.customers).toEqual([]);
    expect(res.body.orders).toHaveLength(1);

    await saved({ orders: [] });
    clearPermissionsCache();
    res = await search(rep.token, pair.a.marker);
    expect(res.body.orders).toEqual([]);
    expect(res.body.customers).toHaveLength(1);

    await prismaBase.systemConfig.updateMany({ where: { tenantId: pair.a.id }, data: { rolePermissions: undefined } });
    clearPermissionsCache();
  });
});
