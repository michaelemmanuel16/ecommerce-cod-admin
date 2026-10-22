/**
 * M3-T17 (COD-24): Customers API (F-350 to F-356). The segment definitions on a fixture of 12 customers, tile counts
 * against the list total, sort, filters, search, row scope, create / edit / delete rules, audit and two tenants.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTenant, createTwoTenants, deleteTenantRows, TwoTenants } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const tail = String(SUFFIX).slice(-4);
// +233 245 <4 digit tail> <2 digit n>: nine national digits, unique per customer
const phone = (n: number) => `+233245${tail}${String(n).padStart(2, '0')}`;
const local = (n: number) => `0${phone(n).slice(4)}`;

let tenantId: string;
let pair: TwoTenants;
const tokens = {} as Record<'owner' | 'manager' | 'rep1' | 'rep2' | 'agent', string>;
const userIds = {} as Record<'rep1' | 'rep2' | 'agent', number>;
const ids = {} as Record<string, number>;

const get = (path: string, token: string, query: Record<string, unknown> = {}) =>
  request(app).get(path).query(query).set(bearer(token));
const list = (query: Record<string, unknown> = {}, token = tokens.owner) => get('/api/customers', token, { limit: 100, ...query });
const names = (res: request.Response) => res.body.customers.map((c: any) => c.firstName).sort();

async function makeUser(role: 'manager' | 'sales_rep' | 'delivery_agent' | 'super_admin', label: string) {
  const u = await prismaBase.user.create({
    data: { email: `cust-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'User', role, tenantId },
  });
  return { id: u.id, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId }) };
}

const customerData = (firstName: string, n: number, extra: Record<string, unknown> = {}) => ({
  firstName, lastName: 'T', phoneNumber: phone(n), address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId, ...extra,
});

async function addCustomer(key: string, firstName: string, n: number, extra: Record<string, unknown> = {}) {
  ids[key] = (await prismaBase.customer.create({ data: customerData(firstName, n, extra) as any })).id;
}

const order = (customerId: number, extra: Record<string, unknown> = {}) =>
  prismaBase.order.create({
    data: {
      customerId, status: 'pending_confirmation', subtotal: 10, totalAmount: 10, codAmount: 10, tenantId,
      deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra', ...extra,
    } as any,
  });

const call = (customerId: number, outcome: string, minutesAgo: number) =>
  prismaBase.call.create({
    data: { customerId, salesRepId: userIds.rep1, outcome: outcome as any, tenantId, createdAt: new Date(Date.now() - minutesAgo * 60_000) },
  });

beforeAll(async () => {
  tenantId = (await createTenant('Customers Api')).id;
  const owner = await makeUser('super_admin', 'owner');
  const manager = await makeUser('manager', 'manager');
  const rep1 = await makeUser('sales_rep', 'rep1');
  const rep2 = await makeUser('sales_rep', 'rep2');
  const agent = await makeUser('delivery_agent', 'agent');
  Object.assign(tokens, { owner: owner.token, manager: manager.token, rep1: rep1.token, rep2: rep2.token, agent: agent.token });
  Object.assign(userIds, { rep1: rep1.id, rep2: rep2.id, agent: agent.id });

  const day = (d: number) => new Date(Date.UTC(2026, 9, d));
  await addCustomer('zero', 'Zero', 0);
  await addCustomer('kofi', 'Kofi', 1, { totalOrders: 1, lastOrderAt: day(10) });
  await addCustomer('ama', 'Ama', 2, { totalOrders: 1, lastOrderAt: day(5), area: 'Kumasi', state: 'Ashanti' });
  await addCustomer('yaw', 'Yaw', 3, { totalOrders: 2, deliveredOrders: 2, deliveredValue: 300, lastOrderAt: day(12) });
  await addCustomer('esi', 'Esi', 4, { totalOrders: 3, deliveredOrders: 2, deliveredValue: 500, refusedOrders: 1, lastOrderAt: day(8), area: 'Kumasi', state: 'Ashanti' });
  await addCustomer('kojo', 'Kojo', 5, { totalOrders: 4, deliveredOrders: 1, deliveredValue: 100, refusedOrders: 2, lastOrderAt: day(3), area: 'Tema' });
  await addCustomer('abena', 'Abena', 6, { lastName: 'Owusu', totalOrders: 5, refusedOrders: 3, lastOrderAt: day(1), area: 'Tamale', state: 'Northern', email: 'abena@example.com', alternatePhone: '+233200001111' });
  await addCustomer('nii', 'Nii', 7, { totalOrders: 1, lastOrderAt: day(2) });
  await addCustomer('efua', 'Efua', 8, { totalOrders: 1, lastOrderAt: day(4) });
  await addCustomer('kwesi', 'Kwesi', 9, { totalOrders: 1, lastOrderAt: day(6) });
  await addCustomer('made', 'Made', 10, { createdById: rep1.id });
  await addCustomer('gone', 'Gone', 11, { isActive: false, totalOrders: 1 });

  // Not reachable: the newest call is not_reachable / no_answer. Efua was reached later, so she is not.
  await call(ids.nii, 'no_answer', 10);
  await call(ids.efua, 'not_reachable', 30);
  await call(ids.efua, 'confirmed', 5);
  await call(ids.kwesi, 'confirmed', 60);
  await call(ids.kwesi, 'not_reachable', 20);

  // Orders that give the reps and the agent their rows
  await order(ids.kofi, { customerRepId: rep1.id });
  await order(ids.ama, { customerRepId: rep2.id });
  await order(ids.yaw, { customerRepId: rep2.id, deliveryAgentId: agent.id, status: 'delivered' });

  pair = await createTwoTenants('customers-api');
}, 120_000);

afterAll(async () => {
  await pair.cleanup();
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('GET /api/customers/summary: the definitions', () => {
  it('counts the segments, the tiles and the percentages', async () => {
    const res = await get('/api/customers/summary', tokens.owner);
    expect(res.status).toBe(200);
    // 11 active customers; "Gone" is deleted
    expect(res.body.segments).toEqual({ all: 11, repeat: 4, first_time: 5, refused_before: 3, not_reachable: 2 });
    expect(res.body.tiles).toMatchObject({ total: 11, firstTime: 5, repeat: 4, blocked: 1, newThisMonth: 11 });
    // First-time + repeat = the 9 customers with orders; the two percentages add to 100
    expect(res.body.tiles.firstTimePct + res.body.tiles.repeatPct).toBe(100);
    expect(res.body.tiles.firstTimePct).toBe(56);
  });
});

describe('tile and tab counts equal the list total for the same filter', () => {
  const filters: Array<Record<string, unknown>> = [
    {}, { area: 'Kumasi' }, { region: 'Greater Accra' }, { risk: 'high' }, { risk: 'low' }, { blocked: 'true' },
    { flagged: 'true' }, { search: 'Ko' }, { area: 'Accra', risk: 'low' },
  ];
  it.each(filters)('filter %j', async (filter) => {
    const summary = await get('/api/customers/summary', tokens.owner, filter);
    expect(summary.status).toBe(200);
    const total = async (extra: Record<string, unknown>) => (await list({ ...filter, ...extra, limit: 1 })).body.pagination.total;
    expect(summary.body.segments.all).toBe(await total({}));
    for (const segment of ['repeat', 'first_time', 'refused_before', 'not_reachable'] as const) {
      expect(summary.body.segments[segment]).toBe(await total({ segment }));
    }
    expect(summary.body.tiles.total).toBe(summary.body.segments.all);
    expect(summary.body.tiles.blocked).toBe(await total({ blocked: 'true' }));
  });

  it('the summary also respects the row scope', async () => {
    const summary = await get('/api/customers/summary', tokens.rep1);
    const rows = await list({}, tokens.rep1);
    expect(summary.body.segments.all).toBe(rows.body.pagination.total);
    expect(summary.body.segments.all).toBe(2);
  });
});

describe('GET /api/customers: filters, search and sort', () => {
  it('shows only active customers with the stats, risk and COD block', async () => {
    const res = await list();
    expect(res.body.pagination.total).toBe(11);
    expect(names(res)).not.toContain('Gone');
    const abena = res.body.customers.find((c: any) => c.firstName === 'Abena');
    expect(abena).toMatchObject({ totalOrders: 5, refusedOrders: 3, risk: 'high', codBlocked: true, notReachable: false });
    expect(abena.unsubscribeToken).toBeUndefined();
    const esi = res.body.customers.find((c: any) => c.firstName === 'Esi');
    expect(esi).toMatchObject({ risk: 'watch', codBlocked: false, deliveredValue: '500.00' });
    expect(res.body.customers.find((c: any) => c.firstName === 'Zero').risk).toBe('low');
  });

  it('segments', async () => {
    expect(names(await list({ segment: 'repeat' }))).toEqual(['Abena', 'Esi', 'Kojo', 'Yaw']);
    expect(names(await list({ segment: 'first_time' }))).toEqual(['Ama', 'Efua', 'Kofi', 'Kwesi', 'Nii']);
    expect(names(await list({ segment: 'refused_before' }))).toEqual(['Abena', 'Esi', 'Kojo']);
    expect(names(await list({ segment: 'not_reachable' }))).toEqual(['Kwesi', 'Nii']);
  });

  it('town, region, risk, blocked, flagged', async () => {
    expect(names(await list({ area: 'Kumasi' }))).toEqual(['Ama', 'Esi']);
    expect(names(await list({ region: 'Northern' }))).toEqual(['Abena']);
    expect(names(await list({ risk: 'watch' }))).toEqual(['Esi']);
    expect(names(await list({ risk: 'high' }))).toEqual(['Abena', 'Kojo']);
    expect(names(await list({ blocked: 'true' }))).toEqual(['Abena']);
    expect((await list({ blocked: 'false' })).body.pagination.total).toBe(10);
    // Repeat refusers (2 or more) and not reachable
    expect(names(await list({ flagged: 'true' }))).toEqual(['Abena', 'Kojo', 'Kwesi', 'Nii']);
    expect(names(await list({ flagged: 'true', area: 'Tema' }))).toEqual(['Kojo']);
  });

  it('search: name, two words, any phone format, alternate phone, email; one character waits', async () => {
    expect(names(await list({ search: 'abena' }))).toEqual(['Abena']);
    expect(names(await list({ search: 'Abena Owusu' }))).toEqual(['Abena']);
    expect(names(await list({ search: local(3) }))).toEqual(['Yaw']);
    expect(names(await list({ search: phone(3) }))).toEqual(['Yaw']);
    expect(names(await list({ search: phone(3).slice(1) }))).toEqual(['Yaw']);
    expect(names(await list({ search: '0200001111' }))).toEqual(['Abena']);
    expect(names(await list({ search: 'abena@example' }))).toEqual(['Abena']);
    expect((await list({ search: 'a' })).body.pagination.total).toBe(11);
  });

  it('sorts on customer, orders, delivered value and last order, server side', async () => {
    const order = async (sortBy: string, sortOrder: string) => (await list({ sortBy, sortOrder })).body.customers.map((c: any) => c.firstName);
    expect((await order('customer', 'asc')).slice(0, 3)).toEqual(['Abena', 'Ama', 'Efua'].sort());
    expect((await order('orders', 'desc')).slice(0, 3)).toEqual(['Abena', 'Kojo', 'Esi']);
    expect((await order('deliveredValue', 'desc')).slice(0, 3)).toEqual(['Esi', 'Yaw', 'Kojo']);
    const last = await order('lastOrder', 'desc');
    expect(last.slice(0, 3)).toEqual(['Yaw', 'Kofi', 'Esi']);
    // Customers with no order go last whichever way it sorts
    expect(last.slice(-2).sort()).toEqual(['Made', 'Zero']);
    const asc = await order('lastOrder', 'asc');
    expect(asc.slice(0, 2)).toEqual(['Abena', 'Nii']);
    expect(asc.slice(-2).sort()).toEqual(['Made', 'Zero']);
  });

  it('an unknown sortBy returns 400; page sizes limit the rows', async () => {
    expect((await list({ sortBy: 'colour' })).status).toBe(400);
    const page = await list({ limit: 25 });
    expect(page.body.pagination).toMatchObject({ limit: 25, total: 11, pages: 1 });
    const small = await list({ limit: 5, page: 3 });
    expect(small.body.customers).toHaveLength(1);
    expect(small.body.pagination.pages).toBe(3);
  });
});

describe('row scope (F-350)', () => {
  it('owner and manager see all; a rep sees created or assigned; an agent sees their own orders', async () => {
    expect((await list({}, tokens.manager)).body.pagination.total).toBe(11);
    expect(names(await list({}, tokens.rep1))).toEqual(['Kofi', 'Made']);
    expect(names(await list({}, tokens.rep2))).toEqual(['Ama', 'Yaw']);
    expect(names(await list({}, tokens.agent))).toEqual(['Yaw']);
  });

  it('the detail follows the same scope', async () => {
    expect((await get(`/api/customers/${ids.made}`, tokens.rep1)).status).toBe(200);
    expect((await get(`/api/customers/${ids.kofi}`, tokens.rep1)).status).toBe(200);
    expect((await get(`/api/customers/${ids.ama}`, tokens.rep1)).status).toBe(403);
    expect((await get(`/api/customers/${ids.yaw}`, tokens.agent)).status).toBe(200);
    expect((await get(`/api/customers/${ids.kofi}`, tokens.agent)).status).toBe(403);
  });
});

describe('GET /api/customers/:id', () => {
  it('returns stats, risk, block state and the average order value', async () => {
    const res = await get(`/api/customers/${ids.esi}`, tokens.owner);
    expect(res.status).toBe(200);
    expect(res.body.customer).toMatchObject({
      totalOrders: 3, deliveredOrders: 2, refusedOrders: 1, deliveredValue: '500.00', averageOrderValue: '250.00',
      risk: 'watch', codBlocked: false, notReachable: false,
    });
    expect((await get(`/api/customers/${ids.nii}`, tokens.owner)).body.customer.notReachable).toBe(true);
    expect((await get(`/api/customers/${ids.zero}`, tokens.owner)).body.customer.averageOrderValue).toBeNull();
  });

  it('a deleted customer opens for the owner roles only', async () => {
    const owner = await get(`/api/customers/${ids.gone}`, tokens.owner);
    expect(owner.status).toBe(200);
    expect(owner.body.customer.isActive).toBe(false);
    expect((await get(`/api/customers/${ids.gone}`, tokens.rep1)).status).toBe(404);
  });
});

describe('create and edit (F-355)', () => {
  const body = (n: number, extra: Record<string, unknown> = {}) => ({
    firstName: 'Fresh', lastName: 'Buyer', phoneNumber: local(n), address: '5 Rd', state: 'Ashanti', area: 'Kumasi', ...extra,
  });

  it('a rep who creates a customer sees them in the list; createdById and an audit row are set', async () => {
    const created = await request(app).post('/api/customers').set(bearer(tokens.rep2)).send(body(20));
    expect(created.status).toBe(201);
    expect(created.body.customer).toMatchObject({ createdById: userIds.rep2, phoneNumber: phone(20), tenantId });
    expect(names(await list({}, tokens.rep2))).toContain('Fresh');
    expect(names(await list({}, tokens.rep1))).not.toContain('Fresh');

    const audit = await prismaBase.auditLog.findFirst({ where: { tenantId, resource: 'customer', resourceId: String(created.body.customer.id), action: 'create' } });
    expect(audit?.userId).toBe(userIds.rep2);
  });

  it('does not take stats or opt-out flags from the body', async () => {
    const res = await request(app).post('/api/customers').set(bearer(tokens.owner))
      .send(body(21, { totalOrders: 99, refusedOrders: 9, smsOptOut: true, createdById: 1 }));
    expect(res.status).toBe(201);
    expect(res.body.customer).toMatchObject({ totalOrders: 0, refusedOrders: 0, smsOptOut: false });
  });

  it('a phone that exists is blocked with the name; letters are an error; required fields', async () => {
    const dup = await request(app).post('/api/customers').set(bearer(tokens.owner)).send(body(6));
    expect(dup.status).toBe(409);
    expect(dup.body.error ?? dup.body.message).toContain('This number belongs to Abena Owusu');
    expect(dup.body).toMatchObject({ code: 'PHONE_BELONGS_TO_OTHER_CUSTOMER', customerId: ids.abena });

    expect((await request(app).post('/api/customers').set(bearer(tokens.owner)).send(body(22, { phoneNumber: '024abc0103' }))).status).toBe(400);
    expect((await request(app).post('/api/customers').set(bearer(tokens.owner)).send({ firstName: 'No', phoneNumber: local(23) })).status).toBe(400);
  });

  it('a deleted customer with the phone is offered for reactivation, and reactivate: true restores them', async () => {
    const blocked = await request(app).post('/api/customers').set(bearer(tokens.owner)).send(body(11));
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ code: 'CUSTOMER_ARCHIVED', customerId: ids.gone });

    const back = await request(app).post('/api/customers').set(bearer(tokens.owner)).send(body(11, { reactivate: true }));
    expect(back.status).toBe(201);
    expect(back.body.customer).toMatchObject({ id: ids.gone, isActive: true, state: 'Ashanti' });
  });

  it('a rep cannot reactivate a deleted customer: plain 409, the row stays inactive, no id; the owner can', async () => {
    await addCustomer('archived', 'Archived', 40, { isActive: false });
    const rep = await request(app).post('/api/customers').set(bearer(tokens.rep1)).send(body(40, { reactivate: true }));
    expect(rep.status).toBe(409);
    expect(rep.body.code).toBe('CUSTOMER_ARCHIVED');
    expect(rep.body.customerId).toBeUndefined();
    expect(rep.body.customerName).toBe('Archived T');
    const row = await prismaBase.customer.findUniqueOrThrow({ where: { id: ids.archived } });
    expect(row).toMatchObject({ isActive: false, state: 'Greater Accra' });

    const owner = await request(app).post('/api/customers').set(bearer(tokens.owner)).send(body(40, { reactivate: true }));
    expect(owner.status).toBe(201);
    expect(owner.body.customer).toMatchObject({ id: ids.archived, isActive: true });
  });

  it('the 409 carries the customer id only when the requester can open that customer', async () => {
    // Abena is outside rep1's scope: name in the message, no id
    const out = await request(app).post('/api/customers').set(bearer(tokens.rep1)).send(body(6));
    expect(out.status).toBe(409);
    expect(out.body.message).toBe('This number belongs to Abena Owusu');
    expect(out.body.customerId).toBeUndefined();
    // Kofi is rep1's own customer: id included
    const inside = await request(app).post('/api/customers').set(bearer(tokens.rep1)).send(body(1));
    expect(inside.body).toMatchObject({ message: 'This number belongs to Kofi T', customerId: ids.kofi });
    // Admin roles always get the id
    const admin = await request(app).post('/api/customers').set(bearer(tokens.manager)).send(body(6));
    expect(admin.body.customerId).toBe(ids.abena);
    // Same on edit
    const edit = await request(app).put(`/api/customers/${ids.kofi}`).set(bearer(tokens.rep1)).send({ phoneNumber: local(6) });
    expect(edit.status).toBe(409);
    expect(edit.body.customerId).toBeUndefined();
  });

  it('edit writes before and after; a rep edits a visible customer, not another rep\'s', async () => {
    const res = await request(app).put(`/api/customers/${ids.kofi}`).set(bearer(tokens.rep1)).send({ landmark: 'By the bank', area: 'Kumasi', firstName: 'Kofi' });
    expect(res.status).toBe(200);
    const audit = await prismaBase.auditLog.findFirst({ where: { tenantId, resource: 'customer', resourceId: String(ids.kofi), action: 'update' } });
    expect(audit?.userId).toBe(userIds.rep1);
    // Only the fields that changed
    expect(audit?.before).toEqual({ area: 'Accra', landmark: null });
    expect(audit?.after).toEqual({ area: 'Kumasi', landmark: 'By the bank' });

    expect((await request(app).put(`/api/customers/${ids.ama}`).set(bearer(tokens.rep1)).send({ landmark: 'x' })).status).toBe(403);
    // Another customer's number: blocked with the name
    const clash = await request(app).put(`/api/customers/${ids.kofi}`).set(bearer(tokens.rep1)).send({ phoneNumber: local(6) });
    expect(clash.status).toBe(409);
    expect(clash.body.customerName).toBe('Abena Owusu');
    // Stats cannot be edited
    await request(app).put(`/api/customers/${ids.kofi}`).set(bearer(tokens.owner)).send({ refusedOrders: 7 });
    expect((await prismaBase.customer.findUniqueOrThrow({ where: { id: ids.kofi } })).refusedOrders).toBe(0);
  });
});

describe('delete (F-356)', () => {
  it('a customer with an order out for delivery returns 409 and stays', async () => {
    await addCustomer('flight', 'Flight', 30);
    await order(ids.flight, { status: 'out_for_delivery' });
    const res = await request(app).delete(`/api/customers/${ids.flight}`).set(bearer(tokens.owner));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CUSTOMER_HAS_ORDER_IN_FLIGHT');
    expect((await prismaBase.customer.findUniqueOrThrow({ where: { id: ids.flight } })).isActive).toBe(true);
  });

  it('other open orders do not block; the orders stay; the customer leaves the list; audit row', async () => {
    await addCustomer('plain', 'Plain', 31);
    const o = await order(ids.plain, { status: 'confirmed' });
    const res = await request(app).delete(`/api/customers/${ids.plain}`).set(bearer(tokens.manager));
    expect(res.status).toBe(200);
    expect(names(await list())).not.toContain('Plain');
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('confirmed');
    const audit = await prismaBase.auditLog.findFirst({ where: { tenantId, resourceId: String(ids.plain), action: 'deactivate' } });
    expect(audit?.before).toEqual({ isActive: true });
    expect(audit?.after).toEqual({ isActive: false });
  });

  it('a rep cannot delete', async () => {
    expect((await request(app).delete(`/api/customers/${ids.kofi}`).set(bearer(tokens.rep1))).status).toBe(403);
  });
});

describe('two tenants', () => {
  it('tenant A never sees tenant B customers in the list, tiles, detail, edit or delete', async () => {
    const { a, b } = pair;
    const bCustomer = b.ids.customer;
    const listA = await get('/api/customers', a.users.admin.token, { limit: 100 });
    expect(listA.status).toBe(200);
    expect(JSON.stringify(listA.body)).not.toContain(b.marker);
    expect(listA.body.customers.map((c: any) => c.id)).not.toContain(bCustomer);

    const summaryA = await get('/api/customers/summary', a.users.admin.token);
    expect(summaryA.body.segments.all).toBe(listA.body.pagination.total);
    const summaryB = await get('/api/customers/summary', b.users.admin.token);
    expect(summaryB.body.segments.all).toBeGreaterThan(0);

    expect((await get(`/api/customers/${bCustomer}`, a.users.admin.token)).status).toBe(404);
    expect((await request(app).put(`/api/customers/${bCustomer}`).set(bearer(a.users.admin.token)).send({ landmark: 'x' })).status).toBe(404);
    expect((await request(app).delete(`/api/customers/${bCustomer}`).set(bearer(a.users.admin.token))).status).toBe(404);

    // The same phone in tenant A is free: a duplicate is checked per tenant
    const res = await request(app).post('/api/customers').set(bearer(a.users.admin.token))
      .send({ firstName: 'Same', phoneNumber: (await prismaBase.customer.findUniqueOrThrow({ where: { id: bCustomer } })).phoneNumber, address: 'x', state: 'x', area: 'x' });
    expect(res.status).toBe(201);
    expect(res.body.customer.tenantId).toBe(a.id);
  });

  it('the not reachable lookup stays inside the tenant', async () => {
    const res = await get('/api/customers', pair.b.users.admin.token, { segment: 'not_reachable' });
    expect(res.body.customers).toHaveLength(0);
  });
});
