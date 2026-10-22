/**
 * M3-T71 (COD-30): the gaps the backend sweep found. Two tenants, HTTP only.
 * Orders list filters (area, call rep, customer) narrow the list and never reach the other tenant.
 * Bulk status and bulk assign change only the chosen orders of the caller's tenant.
 * The owner dashboard counts only the caller's tenant. Settings need the owner role, and A's save never reaches B.
 * Everything else M3 added already has its two-tenant test; the map is in the T71 report.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { bearer, superAdminToken } from './helpers/superAdminToken';

jest.setTimeout(120_000);

let pair: TwoTenants;
let ownerA: string;
let extraCustomerId: number;
const extra: { kumasi: number; bystander: number } = { kumasi: 0, bystander: 0 };

const orderData = (tenantId: string, customerId: number, over: Record<string, unknown> = {}) => ({
  customerId, status: 'pending_confirmation', subtotal: 10, shippingCost: 0, totalAmount: 10, codAmount: 10,
  deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId, ...over,
}) as any;

const listA = (query: Record<string, unknown>) =>
  request(app).get('/api/orders').query({ limit: 100, ...query }).set(bearer(pair.a.users.admin.token));
const ids = (res: request.Response): number[] => res.body.orders.map((o: any) => o.id);

beforeAll(async () => {
  pair = await createTwoTenants('m3sweep');
  ownerA = await superAdminToken(pair.a.id, pair.a.slug, 'sweep-owner');
  extraCustomerId = (await prismaBase.customer.create({
    data: { firstName: 'Kofi', lastName: 'Sweep', phoneNumber: `+23327${String(Date.now()).slice(-7)}`, address: '2 Sweep Rd', state: 'Ashanti', area: 'Kumasi', tenantId: pair.a.id },
  })).id;
  // Two more orders in A: one in another area and customer with no rep, one bystander for the bulk checks.
  extra.kumasi = (await prismaBase.order.create({ data: orderData(pair.a.id, extraCustomerId, { deliveryState: 'Ashanti', deliveryArea: 'Kumasi' }) })).id;
  extra.bystander = (await prismaBase.order.create({ data: orderData(pair.a.id, pair.a.ids.customer) })).id;
}, 120_000);

afterAll(async () => {
  await prismaBase.order.deleteMany({ where: { id: { in: [extra.kumasi, extra.bystander] } } });
  await prismaBase.customer.deleteMany({ where: { id: extraCustomerId } });
  await prismaBase.user.deleteMany({ where: { email: { startsWith: 'sweep-owner-' } } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('orders list filters (F-307)', () => {
  it('area, call rep and customer each narrow the list to the matching orders', async () => {
    expect(ids(await listA({}))).toEqual(expect.arrayContaining([pair.a.ids.order, extra.kumasi, extra.bystander]));

    expect(ids(await listA({ area: 'Kumasi' }))).toEqual([extra.kumasi]);
    expect(ids(await listA({ customerRepId: pair.a.users.salesRep.id }))).toEqual([pair.a.ids.order]);
    expect(ids(await listA({ customerId: extraCustomerId }))).toEqual([extra.kumasi]);
    expect(ids(await listA({ customerId: pair.a.ids.customer })).sort()).toEqual([pair.a.ids.order, extra.bystander].sort());
  });

  it('the other tenant\'s rep, agent, customer and area give A nothing', async () => {
    expect(ids(await listA({ customerRepId: pair.b.users.salesRep.id }))).toEqual([]);
    expect(ids(await listA({ deliveryAgentId: pair.b.users.deliveryAgent.id }))).toEqual([]);
    expect(ids(await listA({ customerId: pair.b.ids.customer }))).toEqual([]);
    expect(ids(await listA({ ids: String(pair.b.ids.order) }))).toEqual([]);
  });
});

describe('bulk actions touch only the chosen orders of the caller\'s tenant', () => {
  it('bulk status: the chosen A order moves, the B order is NOT_FOUND and unchanged, the bystander stays', async () => {
    const res = await request(app).patch('/api/orders/bulk/status').set(bearer(pair.a.users.admin.token))
      .send({ orderIds: [extra.kumasi, pair.b.ids.order], status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual([extra.kumasi]);
    expect(res.body.failed).toEqual([expect.objectContaining({ id: pair.b.ids.order, code: 'NOT_FOUND' })]);
    const rows = await prismaBase.order.findMany({ where: { id: { in: [extra.kumasi, extra.bystander, pair.b.ids.order] } }, select: { id: true, status: true } });
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
      [extra.kumasi]: 'confirmed', [extra.bystander]: 'pending_confirmation', [pair.b.ids.order]: 'out_for_delivery',
    });
  });

  it('bulk assign: the chosen A order gets the A rep; a B order and the bystander are untouched', async () => {
    const before = await prismaBase.order.findUniqueOrThrow({ where: { id: pair.b.ids.order }, select: { customerRepId: true } });
    const res = await request(app).patch('/api/orders/bulk/assign').set(bearer(pair.a.users.admin.token))
      .send({ orderIds: [extra.kumasi, pair.b.ids.order], customerRepId: pair.a.users.salesRep.id });
    expect(res.status).toBe(200);
    expect(res.body.succeeded).toEqual([extra.kumasi]);
    expect(res.body.failed).toEqual([expect.objectContaining({ id: pair.b.ids.order })]);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: extra.kumasi } })).customerRepId).toBe(pair.a.users.salesRep.id);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: extra.bystander } })).customerRepId).toBeNull();
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: pair.b.ids.order } })).customerRepId).toBe(before.customerRepId);
  });

  it('bulk assign with a rep of the other tenant assigns nothing', async () => {
    const res = await request(app).patch('/api/orders/bulk/assign').set(bearer(pair.a.users.admin.token))
      .send({ orderIds: [extra.bystander], customerRepId: pair.b.users.salesRep.id });
    expect(res.body.succeeded ?? []).toEqual([]);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: extra.bystander } })).customerRepId).toBeNull();
  });
});

describe('GET /api/dashboard/owner', () => {
  it('counts the orders of the caller\'s tenant only', async () => {
    const get = (token: string) => request(app).get('/api/dashboard/owner').query({ range: 'month' }).set(bearer(token));
    const a = await get(pair.a.users.admin.token);
    const b = await get(pair.b.users.admin.token);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    // A has three orders this month (the seeded one and two more), B has its one.
    expect(a.body.tiles.confirmationRate.placed).toBe(3);
    expect(b.body.tiles.confirmationRate.placed).toBe(1);
    expect(JSON.stringify(a.body)).not.toContain(pair.b.marker);
    expect(JSON.stringify(b.body)).not.toContain(pair.a.marker);
  });
});

describe('/api/admin/settings (business details)', () => {
  const settings = (method: 'get' | 'put', token: string) => request(app)[method]('/api/admin/settings').set(bearer(token));

  it('the owner reads and writes; an admin and a call rep get 403 on both', async () => {
    expect((await settings('get', ownerA)).status).toBe(200);
    const saved = await settings('put', ownerA).send({ contactPerson: 'Sweep Owner' });
    expect(saved.status).toBe(200);
    expect(saved.body.contactPerson).toBe('Sweep Owner');

    for (const token of [pair.a.users.admin.token, pair.a.users.salesRep.token]) {
      expect((await settings('get', token)).status).toBe(403);
      expect((await settings('put', token).send({ contactPerson: 'Nope' })).status).toBe(403);
    }
    expect((await settings('get', ownerA)).body.contactPerson).toBe('Sweep Owner');
  });

  it('A\'s save never reaches B', async () => {
    const config = await prismaBase.systemConfig.findFirstOrThrow({ where: { tenantId: pair.b.id } });
    expect(config.contactPerson).toBeNull();
  });

  it('401 without a token', async () => {
    expect((await request(app).get('/api/admin/settings')).status).toBe(401);
  });
});
