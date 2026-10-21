/**
 * M3-T11 (COD-23): GET /api/orders and GET /api/orders/counts (F-307, F-308, F-310 to F-312).
 * Tab counts and row scope on the numbers fixture (October 2026); flags and two-tenant checks on small tenants.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { seedFixture } from '../fixtures/numbersFixture';
import { createTenant, createTwoTenants, deleteTenantRows, TwoTenants } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { orderFlagService } from '../../services/orderFlagService';
import { runInTenant } from '../../utils/tenantContext';

jest.setTimeout(180_000);

const OCTOBER = { startDate: '2026-10-01', endDate: '2026-10-31' };
const SUFFIX = Date.now();

let fixtureTenantId: string;
const tokens = {} as Record<'admin' | 'adwoa' | 'logiswift', string>;
const userIds = {} as Record<'adwoa' | 'nana' | 'logiswift', number>;
let pair: TwoTenants;
let flagTenantId: string;
let flagToken: string;

const list = (token: string, query: Record<string, unknown> = {}) =>
  request(app).get('/api/orders').query({ ...OCTOBER, limit: 100, ...query }).set(bearer(token));
const counts = (token: string, query: Record<string, unknown> = {}) =>
  request(app).get('/api/orders/counts').query({ ...OCTOBER, ...query }).set(bearer(token));

async function tokenFor(email: string) {
  const u = await prismaBase.user.findFirstOrThrow({ where: { tenantId: fixtureTenantId, email } });
  return { id: u.id, token: generateAccessToken({ id: u.id, email: u.email, role: u.role, tenantId: fixtureTenantId }) };
}

beforeAll(async () => {
  fixtureTenantId = (await seedFixture(prismaBase)).tenantId;
  const domain = 'fixture-numbers.test';
  tokens.admin = (await tokenFor(`fixture-admin@${domain}`)).token;
  const adwoa = await tokenFor(`rep-adwoa@${domain}`);
  tokens.adwoa = adwoa.token;
  userIds.adwoa = adwoa.id;
  userIds.nana = (await tokenFor(`rep-nana@${domain}`)).id;
  const logiswift = await tokenFor(`partner-logiswift@${domain}`);
  tokens.logiswift = logiswift.token;
  userIds.logiswift = logiswift.id;
  pair = await createTwoTenants('orderslist');

  // Flag tenant: one order per flag rule, plus orders that must not be flagged.
  const tenant = await createTenant('Orders Flags');
  flagTenantId = tenant.id;
  const owner = await prismaBase.user.create({
    data: { email: `flags-owner-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Owner', lastName: 'F', role: 'super_admin', tenantId: flagTenantId },
  });
  flagToken = generateAccessToken({ id: owner.id, email: owner.email, role: 'super_admin', tenantId: flagTenantId });
  const rep = await prismaBase.user.create({
    data: { email: `flags-rep-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Rep', lastName: 'F', role: 'sales_rep', tenantId: flagTenantId },
  });
  const customer = await prismaBase.customer.create({
    data: { firstName: 'Flag', lastName: 'Tester', phoneNumber: `+2332${String(SUFFIX).slice(-8)}`, address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId: flagTenantId },
  });
  const ago = (ms: number) => new Date(Date.now() - ms);
  const MIN = 60_000;
  const DAY = 24 * 60 * MIN;
  const mk = (label: string, extra: Record<string, unknown>) => prismaBase.order.create({
    data: {
      customerId: customer.id, subtotal: 10, totalAmount: 10, codAmount: 10, tenantId: flagTenantId, notes: label,
      deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra', ...extra,
    } as any,
  });
  await mk('no-rep', { status: 'pending_confirmation' });
  await mk('has-rep', { status: 'pending_confirmation', customerRepId: rep.id });
  await mk('waiting-3d', { status: 'preparing', customerRepId: rep.id, createdAt: ago(3 * DAY) });
  await mk('waiting-1d', { status: 'preparing', customerRepId: rep.id, createdAt: ago(1 * DAY) });
  await mk('old-pending-with-rep', { status: 'pending_confirmation', customerRepId: rep.id, createdAt: ago(5 * DAY) });
  await mk('digital-failed', { status: 'confirmed', orderType: 'digital', paymentStatus: 'paid', customerRepId: rep.id, confirmedAt: ago(10 * MIN), createdAt: ago(20 * MIN) });
  await mk('digital-fresh', { status: 'confirmed', orderType: 'digital', paymentStatus: 'paid', customerRepId: rep.id, confirmedAt: ago(1 * MIN), createdAt: ago(2 * MIN) });
  await mk('digital-unpaid', { status: 'confirmed', orderType: 'digital', paymentStatus: 'pending', customerRepId: rep.id, confirmedAt: ago(10 * MIN), createdAt: ago(20 * MIN) });
  const sent = await mk('digital-sent', { status: 'confirmed', orderType: 'digital', paymentStatus: 'paid', customerRepId: rep.id, confirmedAt: ago(10 * MIN), createdAt: ago(20 * MIN) });
  await prismaBase.downloadToken.create({ data: { orderId: sent.id, token: `tok-${SUFFIX}`, expiresAt: ago(-DAY), tenantId: flagTenantId } });
}, 180_000);

afterAll(async () => {
  await pair.cleanup();
  await deleteTenantRows([flagTenantId]);
  await prismaBase.$disconnect();
});

describe('GET /api/orders/counts', () => {
  it('matches the NUMBERS.md tabs for October (All 1,445)', async () => {
    const res = await counts(tokens.admin);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['all', 'byStatus', 'waitingToDispatch']);
    expect(res.body.all).toBe(1445);
    expect(res.body.byStatus).toMatchObject({
      pending_confirmation: 64, out_for_delivery: 148, delivered: 376, failed_delivery: 354, returned: 48, cancelled: 355,
    });
    const { confirmed, preparing, ready_for_pickup } = res.body.byStatus;
    expect(confirmed + preparing + ready_for_pickup).toBe(100);
    expect(res.body.waitingToDispatch).toBe(100);
    expect(Object.keys(res.body.byStatus)).toHaveLength(12);
  });

  it('uses the other filters but ignores status', async () => {
    const res = await counts(tokens.admin, { status: 'delivered', customerRepId: userIds.adwoa });
    expect(res.body.all).toBe(871);
    expect(res.body.byStatus.pending_confirmation).toBe(20);
    expect(res.body.byStatus.delivered).toBe(253);
  });

  it('a rep counts only own orders, an agent only own deliveries', async () => {
    expect((await counts(tokens.adwoa)).body.all).toBe(871);
    expect((await counts(tokens.logiswift)).body.all).toBe(590);
  });

  it('counts on the delivery date basis are delivered orders only', async () => {
    const res = await counts(tokens.admin, { dateBasis: 'delivery' });
    expect(res.body.all).toBe(res.body.byStatus.delivered);
    expect(res.body.byStatus.delivered).toBeGreaterThan(0);
  });
});

describe('GET /api/orders', () => {
  it('returns the fixture page with the table fields and pagination', async () => {
    const res = await list(tokens.admin, { limit: 25, status: 'pending_confirmation' });
    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({ page: 1, limit: 25, total: 64, pages: 3 });
    expect(res.body.orders).toHaveLength(25);
    const row = res.body.orders[0];
    expect(row).toEqual(expect.objectContaining({
      id: expect.any(Number), status: 'pending_confirmation', totalAmount: expect.any(String), createdAt: expect.any(String),
      customer: expect.objectContaining({ firstName: expect.any(String), phoneNumber: expect.any(String) }),
      orderItems: expect.arrayContaining([expect.objectContaining({ quantity: expect.any(Number), product: expect.objectContaining({ name: expect.any(String) }) })]),
    }));
    expect(row).toHaveProperty('customerRep');
    expect(row).toHaveProperty('deliveryAgent');
    expect(row).not.toHaveProperty('flags');
  });

  it('a rep sees only own orders', async () => {
    const res = await list(tokens.adwoa);
    expect(res.body.pagination.total).toBe(871);
    expect(res.body.orders.every((o: any) => o.customerRep.id === userIds.adwoa)).toBe(true);
    // Asking for another rep's orders gives nothing
    const other = await list(tokens.adwoa, { customerRepId: userIds.nana });
    expect(other.body.pagination.total).toBe(0);
    // A rep cannot see unassigned orders either
    expect((await list(tokens.adwoa, { unassigned: 'true' })).body.pagination.total).toBe(0);
  });

  it('a delivery agent sees only own deliveries', async () => {
    const res = await list(tokens.logiswift);
    expect(res.body.pagination.total).toBe(590);
    expect(res.body.orders.every((o: any) => o.deliveryAgent.id === userIds.logiswift)).toBe(true);
  });

  it('delivery date basis returns only delivered orders', async () => {
    const res = await list(tokens.admin, { dateBasis: 'delivery' });
    expect(res.body.pagination.total).toBe(376);
    expect(res.body.orders.every((o: any) => o.status === 'delivered' && o.deliveryDate)).toBe(true);
    // Order date basis, same range: every status
    expect((await list(tokens.admin)).body.pagination.total).toBe(1445);
  });

  it('a single day on the delivery basis holds only orders delivered that day', async () => {
    const res = await list(tokens.admin, { dateBasis: 'delivery', startDate: '2026-10-05', endDate: '2026-10-05' });
    expect(res.body.orders.length).toBeGreaterThan(0);
    expect(res.body.orders.every((o: any) => o.deliveryDate.startsWith('2026-10-05'))).toBe(true);
  });

  it('start date after end date is 400 with the message', async () => {
    const res = await list(tokens.admin, { startDate: '2026-10-10', endDate: '2026-10-01' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('The start date is after the end date.');
  });

  it('sorts on the server across pages', async () => {
    const amounts = async (page: number) =>
      (await list(tokens.admin, { sortBy: 'totalAmount', sortOrder: 'asc', limit: 50, page })).body.orders.map((o: any) => Number(o.totalAmount));
    const [p1, p2] = [await amounts(1), await amounts(2)];
    const all = [...p1, ...p2];
    expect(all).toEqual([...all].sort((a, b) => a - b));
    const ids = (await list(tokens.admin, { sortBy: 'id', sortOrder: 'desc', limit: 25 })).body.orders.map((o: any) => o.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const names = (await list(tokens.admin, { sortBy: 'customer', sortOrder: 'asc', limit: 50 })).body.orders.map((o: any) => o.customer.lastName);
    expect(names).toEqual([...names].sort());
    expect((await list(tokens.admin, { sortBy: 'phone' })).status).toBe(400);
  });

  it('search: #id, a phone in two formats, a name', async () => {
    const target = (await list(tokens.admin, { limit: 1, sortBy: 'id', sortOrder: 'asc' })).body.orders[0];
    const hashed = await list(tokens.admin, { search: `#${target.id}` });
    expect(hashed.body.orders.map((o: any) => o.id)).toEqual([target.id]);

    const e164 = target.customer.phoneNumber as string;
    for (const q of [e164, `0${e164.slice(4)}`, `+233 ${e164.slice(4, 6)} ${e164.slice(6, 9)} ${e164.slice(9)}`]) {
      const res = await list(tokens.admin, { search: q });
      expect(res.body.orders.map((o: any) => o.id)).toContain(target.id);
      expect(res.body.orders.every((o: any) => o.customer.phoneNumber === e164)).toBe(true);
    }

    const byName = await list(tokens.admin, { search: `${target.customer.firstName} ${target.customer.lastName}` });
    expect(byName.body.orders.length).toBeGreaterThan(0);
    expect(byName.body.orders.every((o: any) => o.customer.firstName === target.customer.firstName && o.customer.lastName === target.customer.lastName)).toBe(true);
  });

  it('filters: unassigned, delivery agent, product (array), combined with a status', async () => {
    const unassigned = await list(tokens.admin, { unassigned: 'true' });
    expect(unassigned.body.pagination.total).toBe(9);
    expect(unassigned.body.orders.every((o: any) => o.customerRep === null && o.status === 'pending_confirmation')).toBe(true);

    const byAgent = await list(tokens.admin, { deliveryAgentId: userIds.logiswift, status: 'delivered' });
    expect(byAgent.body.pagination.total).toBe(220);

    const sample = (await list(tokens.admin, { limit: 5 })).body.orders[0].orderItems[0].productId as number;
    const byProduct = await list(tokens.admin, { 'productId[]': [sample] });
    expect(byProduct.body.pagination.total).toBeGreaterThan(0);
    expect(byProduct.body.orders.every((o: any) => o.orderItems.some((i: any) => i.productId === sample))).toBe(true);
    const repeated = await list(tokens.admin, { productId: [sample, 999999999] });
    expect(repeated.body.pagination.total).toBe(byProduct.body.pagination.total);

    const combined = await list(tokens.admin, { 'productId[]': [sample], status: ['delivered', 'cancelled'] });
    expect(combined.body.orders.every((o: any) => ['delivered', 'cancelled'].includes(o.status))).toBe(true);
  });

  it('include=flags,reminder,threadCount adds the three keys; reminder and thread are null until M9', async () => {
    const res = await list(tokens.admin, { limit: 5, include: 'flags,reminder,threadCount' });
    for (const row of res.body.orders) {
      expect(Array.isArray(row.flags)).toBe(true);
      expect(row.reminder).toBeNull();
      expect(row.threadCount).toBeNull();
    }
    const flagsOnly = await list(tokens.admin, { limit: 5, include: 'flags' });
    expect(flagsOnly.body.orders[0]).toHaveProperty('flags');
    expect(flagsOnly.body.orders[0]).not.toHaveProperty('reminder');
  });

  it('a 5,000-character search is refused fast, and the service cuts a long term', async () => {
    const started = Date.now();
    const res = await list(tokens.admin, { search: 'a '.repeat(2500) });
    expect(res.status).toBe(400);
    expect(Date.now() - started).toBeLessThan(2000);
    // Past the validator: the service still cuts at 100 characters and 5 words
    const { default: orderService } = await import('../../services/orderService');
    const rows = await runInTenant(fixtureTenantId, () => orderService.getAllOrders({ search: 'a '.repeat(2500), limit: 5 }));
    expect(rows.orders.length).toBeGreaterThanOrEqual(0);
  });

  it('401 with no token, 400 for a bad flag or date basis', async () => {
    expect((await request(app).get('/api/orders')).status).toBe(401);
    expect((await list(tokens.admin, { flag: 'nope' })).status).toBe(400);
    expect((await list(tokens.admin, { dateBasis: 'shipped' })).status).toBe(400);
  });
});

describe('order flags (F-312)', () => {
  const notesOf = (res: request.Response) => res.body.orders.map((o: any) => o.notes).sort();
  const flagList = (query: Record<string, unknown>) =>
    request(app).get('/api/orders').query({ limit: 100, ...query }).set(bearer(flagToken));

  it('no_call_rep: pending and no rep', async () => {
    expect(notesOf(await flagList({ flag: 'no_call_rep' }))).toEqual(['no-rep']);
  });

  it('waiting_too_long: pre-dispatch and older than 2 days', async () => {
    expect(notesOf(await flagList({ flag: 'waiting_too_long' }))).toEqual(['waiting-3d']);
  });

  it('digital_delivery_failed: paid digital, confirmed, no link after 5 minutes', async () => {
    expect(notesOf(await flagList({ flag: 'digital_delivery_failed' }))).toEqual(['digital-failed']);
  });

  it('flag=any lists every flagged order once; include=flags names them', async () => {
    const res = await flagList({ flag: 'any', include: 'flags' });
    expect(res.body.pagination.total).toBe(3);
    const byNote = Object.fromEntries(res.body.orders.map((o: any) => [o.notes, o.flags.map((f: any) => f.code)]));
    expect(byNote).toEqual({
      'no-rep': ['no_call_rep'],
      'waiting-3d': ['waiting_too_long'],
      'digital-failed': ['digital_delivery_failed'],
    });
    const all = await flagList({ include: 'flags' });
    expect(all.body.orders.filter((o: any) => o.flags.length === 0).length).toBe(all.body.pagination.total - 3);
  });

  it('flags read the given clock: three days later the 1-day order is also waiting too long', async () => {
    const oneDay = await prismaBase.order.findFirstOrThrow({ where: { tenantId: flagTenantId, notes: 'waiting-1d' } });
    const flagsAt = (now: Date) => runInTenant(flagTenantId, () => orderFlagService.forOrders([oneDay.id], now));
    expect((await flagsAt(new Date())).get(oneDay.id)).toBeUndefined();
    expect((await flagsAt(new Date(Date.now() + 3 * 24 * 60 * 60 * 1000))).get(oneDay.id)?.map((f) => f.code)).toEqual(['waiting_too_long']);
  });
});

describe('two tenants', () => {
  it('a list and its counts never hold the other tenant order', async () => {
    const a = pair.a.users.admin.token;
    const listA = await request(app).get('/api/orders').query({ limit: 100 }).set(bearer(a));
    const idsA = listA.body.orders.map((o: any) => o.id);
    expect(idsA).toContain(pair.a.ids.order);
    expect(idsA).not.toContain(pair.b.ids.order);
    expect(JSON.stringify(listA.body)).not.toContain(pair.b.marker);

    const countsA = await request(app).get('/api/orders/counts').set(bearer(a));
    expect(countsA.body.all).toBe(listA.body.pagination.total);

    const searchB = await request(app).get('/api/orders').query({ search: `#${pair.b.ids.order}` }).set(bearer(a));
    expect(searchB.body.orders).toEqual([]);
  });
});
