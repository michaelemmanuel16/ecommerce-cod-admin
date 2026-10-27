/**
 * M4-T19 (COD-42): partners write API, availability, assignment skip and region normalisation.
 * One throwaway tenant (Ghana, GHS) and one other tenant on the test DB.
 */
import { jest, describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { runInTenant } from '../../utils/tenantContext';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import assignmentService from '../../services/assignmentService';
import workflowService from '../../services/workflowService';
import { executeAction } from '../../queues/workflowQueue';
import { getSocketInstance } from '../../utils/socketInstance';
import { bearer } from './helpers/superAdminToken';
import { stockUp } from './helpers/stock';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(),
  hasSocketInstance: jest.fn(() => true),
}));

jest.setTimeout(120_000);

const SUFFIX = Date.now();
let tenantId: string;
let otherTenantId: string;
let customerId: number;
let productId: number;
const U: Record<string, { id: number; email: string; token: string }> = {};
let otherAgentId: number;

// resetMocks wipes jest.fn implementations before each test, so the emitter is a plain object put back in beforeEach
const emitted: Array<{ event: string; data: any }> = [];
const io = { to: () => ({ emit: (event: string, data: any) => { emitted.push({ event, data }); } }), emit: () => undefined };
beforeEach(() => {
  emitted.length = 0;
  (getSocketInstance as jest.Mock).mockReturnValue(io);
});

const mkUser = async (label: string, role: any, extra: Record<string, unknown> = {}) => {
  const u = await prismaBase.user.create({
    data: { email: `dpw-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'W', role, tenantId, ...extra },
  });
  U[label] = { id: u.id, email: u.email, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId }) };
  return u;
};
const mkOrder = async (status: string, extra: Record<string, unknown> = {}) =>
  (await prismaBase.order.create({
    data: {
      customerId, status, subtotal: 10, totalAmount: 10, codAmount: 10, tenantId,
      deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra', ...extra,
    } as any,
  })).id;

const post = (who: string, body: Record<string, unknown>) => request(app).post('/api/delivery-partners').set(bearer(U[who].token)).send(body);
const person = (n: string, extra: Record<string, unknown> = {}) => ({
  kind: 'person', firstName: `Kojo${n}`, lastName: 'Mensah', email: `kojo${n}-${SUFFIX}@codadmin.test`, phoneNumber: '+233241112233', ...extra,
});

beforeAll(async () => {
  tenantId = (await createTenant('Partners Write')).id;
  otherTenantId = (await createTenant('Partners Write Other')).id;
  await seedTenantDefaults(tenantId);
  await seedTenantDefaults(otherTenantId);
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-8)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  productId = (await prismaBase.product.create({ data: { sku: `PW-${SUFFIX}`, name: 'Copybook', category: 'x', price: 50, stockQuantity: 20, tenantId } })).id;
  await stockUp(tenantId, productId, 20); // available to sell comes from the levels (M4-T16)
  await mkUser('admin', 'admin');
  await mkUser('manager', 'manager');
  await mkUser('stock', 'inventory_manager');
  await mkUser('rep', 'sales_rep');
  await mkUser('agent', 'delivery_agent');
  await mkUser('agent2', 'delivery_agent');
  await mkUser('away', 'delivery_agent', { isAvailable: false });
  const other = await prismaBase.user.create({
    data: { email: `dpw-other-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Other', lastName: 'Agent', role: 'delivery_agent', tenantId: otherTenantId },
  });
  otherAgentId = other.id;
}, 60_000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('POST /api/delivery-partners (F-708)', () => {
  it('a person: user, stock location and profile in one go, defaults from the person rule', async () => {
    const res = await post('admin', person('1', { baseTown: 'Kumasi', vehicleType: 'Motorcycle' }));
    expect(res.status).toBe(201);
    const p = res.body.partner;
    expect(p).toMatchObject({ name: 'Kojo1 Mensah', kind: 'person', type: 'agent', isAvailable: true, vehicleType: 'Motorbike' });
    expect(p.profile).toEqual({ daysToPay: 7, isTrial: false, dataSource: 'app', baseTown: 'Kumasi' });
    expect(p.stockLocation).toMatchObject({ name: 'Kojo1 Mensah', type: 'agent' });

    const user = await prismaBase.user.findUniqueOrThrow({ where: { id: p.id } });
    expect(user).toMatchObject({ role: 'delivery_agent', kind: 'person', tenantId, vehicleType: 'Motorbike' });
    expect(user.password).not.toBe('x');
    const location = await prismaBase.stockLocation.findFirstOrThrow({ where: { userId: p.id } });
    expect(location).toMatchObject({ type: 'agent', tenantId, isActive: true });
    const profile = await prismaBase.deliveryPartnerProfile.findUniqueOrThrow({ where: { userId: p.id } });
    expect(profile).toMatchObject({ daysToPay: 7, isTrial: false, dataSource: 'app', tenantId });
    const audit = await prismaBase.auditLog.findFirstOrThrow({ where: { tenantId, resource: 'delivery_partner', resourceId: String(p.id), action: 'create' } });
    expect(audit).toMatchObject({ userId: U.admin.id, channel: 'app' });
  });

  it('a company: 3PL location, CSV data source, trial flag and days to pay from the request', async () => {
    const res = await post('admin', { kind: 'company', firstName: 'Swift', lastName: 'Couriers', email: `swift-${SUFFIX}@codadmin.test`, isTrial: true, daysToPay: 9 });
    expect(res.status).toBe(201);
    expect(res.body.partner).toMatchObject({ kind: 'company', type: '3pl', stockLocation: { type: 'partner_3pl', name: 'Swift Couriers' } });
    expect(res.body.partner.profile).toMatchObject({ dataSource: 'csv', isTrial: true, daysToPay: 9 });
    const user = await prismaBase.user.findUniqueOrThrow({ where: { id: res.body.partner.id } });
    expect(user.kind).toBe('company');
  });

  it('a person with a login: the password they set works for sign in', async () => {
    const res = await post('admin', person('login', { password: 'Sup3rSecret!' }));
    expect(res.status).toBe(201);
    const login = await request(app).post('/api/auth/login').send({ email: `kojologin-${SUFFIX}@codadmin.test`, password: 'Sup3rSecret!' });
    expect(login.status).toBe(200);
  });

  it('a duplicate email is 409 and nothing is left behind', async () => {
    const first = await post('admin', person('dup'));
    expect(first.status).toBe(201);
    const res = await post('admin', { ...person('dup2'), email: `kojodup-${SUFFIX}@codadmin.test` });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_EXISTS');
    expect(await prismaBase.stockLocation.count({ where: { tenantId, name: 'Kojodup2 Mensah' } })).toBe(0);
  });

  it('a duplicate location name is 409 and rolls back the user and the profile', async () => {
    expect((await post('admin', person('same'))).status).toBe(201);
    const res = await post('admin', { ...person('same'), email: `different-${SUFFIX}@codadmin.test` });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LOCATION_EXISTS');
    expect(await prismaBase.user.count({ where: { email: `different-${SUFFIX}@codadmin.test` } })).toBe(0);
  });

  it('validation: kind, name, email, vehicle type, days to pay, data source', async () => {
    expect((await post('admin', person('v1', { kind: 'team' }))).status).toBe(400);
    expect((await post('admin', person('v2', { firstName: '  ' }))).status).toBe(400);
    expect((await post('admin', person('v3', { email: 'not-an-email' }))).status).toBe(400);
    expect((await post('admin', person('v4', { vehicleType: 'Rocket' }))).status).toBe(400);
    expect((await post('admin', person('v5', { daysToPay: -1 }))).status).toBe(400);
    expect((await post('admin', person('v6', { dataSource: 'ftp' }))).status).toBe(400);
    expect(await prismaBase.user.count({ where: { tenantId, email: { startsWith: 'kojov' } } })).toBe(0);
  });

  it('owner and admin only', async () => {
    for (const who of ['manager', 'stock', 'rep', 'agent']) expect([who, (await post(who, person('x'))).status]).toEqual([who, 403]);
    expect((await request(app).post('/api/delivery-partners').send(person('x'))).status).toBe(401);
  });
});

describe('GET and PATCH /api/delivery-partners/:id (F-707)', () => {
  let id: number;
  beforeAll(async () => {
    id = (await post('admin', person('edit'))).body.partner.id;
  });

  it('GET returns the profile, the location and the fee rule to a role that may see money', async () => {
    await prismaBase.feeRule.create({ data: { tenantId, partnerUserId: id, outcome: 'delivered', amount: '25', validFrom: new Date('2026-01-01') } });
    const admin = await request(app).get(`/api/delivery-partners/${id}`).set(bearer(U.admin.token));
    expect(admin.status).toBe(200);
    expect(admin.body.partner).toMatchObject({ id, name: 'Kojoedit Mensah', stockLocation: { type: 'agent' }, feeRule: { delivered: '25.00', failed: null, returned: null } });
    const stock = await request(app).get(`/api/delivery-partners/${id}`).set(bearer(U.stock.token));
    expect(stock.status).toBe(200);
    expect(stock.body.partner.feeRule).toBeUndefined();
    expect((await request(app).get(`/api/delivery-partners/${id}`).set(bearer(U.rep.token))).status).toBe(403);
  });

  it('GET: a partner of another tenant, a user who is not a partner and an unknown id are 404; a non-number is 404 too', async () => {
    for (const other of [otherAgentId, U.rep.id, 99999999]) {
      expect([other, (await request(app).get(`/api/delivery-partners/${other}`).set(bearer(U.admin.token))).status]).toEqual([other, 404]);
    }
    expect((await request(app).get('/api/delivery-partners/abc').set(bearer(U.admin.token))).status).toBe(404);
  });

  it('PATCH changes the profile and the vehicle, maps old vehicle types, and writes an audit row', async () => {
    const res = await request(app).patch(`/api/delivery-partners/${id}`).set(bearer(U.admin.token))
      .send({ daysToPay: 12, isTrial: true, dataSource: 'connector', baseTown: 'Tamale', vehicleType: 'Van', vehicleId: 'GR-1234-22' });
    expect(res.status).toBe(200);
    expect(res.body.partner.profile).toEqual({ daysToPay: 12, isTrial: true, dataSource: 'connector', baseTown: 'Tamale' });
    expect(res.body.partner).toMatchObject({ vehicleType: 'Car', vehicleId: 'GR-1234-22' });
    expect(await prismaBase.deliveryPartnerProfile.findUniqueOrThrow({ where: { userId: id } })).toMatchObject({ daysToPay: 12, isTrial: true, dataSource: 'connector', baseTown: 'Tamale' });
    const audit = await prismaBase.auditLog.findFirstOrThrow({ where: { tenantId, resource: 'delivery_partner', resourceId: String(id), action: 'update' } });
    expect((audit.metadata as any).changes).toEqual(expect.arrayContaining(['daysToPay', 'isTrial', 'dataSource', 'baseTown', 'vehicleType', 'vehicleId']));
  });

  it('PATCH: a stored legacy vehicle type reads back mapped; a partner with no profile gets one', async () => {
    const legacy = await mkUser('legacy', 'delivery_agent', { vehicleType: 'Motorcycle' });
    const get = await request(app).get(`/api/delivery-partners/${legacy.id}`).set(bearer(U.admin.token));
    expect(get.body.partner.vehicleType).toBe('Motorbike');
    expect(get.body.partner.profile).toEqual({ daysToPay: 7, isTrial: false, dataSource: 'app', baseTown: null });
    expect(await prismaBase.deliveryPartnerProfile.count({ where: { userId: legacy.id } })).toBe(0);
    const res = await request(app).patch(`/api/delivery-partners/${legacy.id}`).set(bearer(U.admin.token)).send({ daysToPay: 3 });
    expect(res.status).toBe(200);
    expect(await prismaBase.deliveryPartnerProfile.findUniqueOrThrow({ where: { userId: legacy.id } })).toMatchObject({ daysToPay: 3, dataSource: 'app', tenantId });
  });

  it('PATCH: bad values are 400, other roles are 403, another tenant is 404', async () => {
    const h = bearer(U.admin.token);
    expect((await request(app).patch(`/api/delivery-partners/${id}`).set(h).send({ vehicleType: 'Rocket' })).status).toBe(400);
    expect((await request(app).patch(`/api/delivery-partners/${id}`).set(h).send({ daysToPay: 999 })).status).toBe(400);
    expect((await request(app).patch(`/api/delivery-partners/${id}`).set(h).send({ dataSource: 'ftp' })).status).toBe(400);
    expect((await request(app).patch(`/api/delivery-partners/${id}`).set(bearer(U.manager.token)).send({ daysToPay: 3 })).status).toBe(403);
    expect((await request(app).patch(`/api/delivery-partners/${otherAgentId}`).set(h).send({ daysToPay: 3 })).status).toBe(404);
    expect(await prismaBase.deliveryPartnerProfile.count({ where: { userId: otherAgentId } })).toBe(0);
  });
});

describe('availability switch (F-709)', () => {
  const patch = (who: string, id: number, isAvailable: unknown) =>
    request(app).patch(`/api/delivery-partners/${id}/availability`).set(bearer(U[who].token)).send({ isAvailable });

  it('admin and manager switch it and agent:availability_changed fires with the agent id', async () => {
    const off = await patch('admin', U.agent.id, false);
    expect(off.status).toBe(200);
    expect(off.body.partner).toEqual({ id: U.agent.id, isAvailable: false });
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: U.agent.id } })).isAvailable).toBe(false);
    expect(emitted).toEqual([{ event: 'agent:availability_changed', data: { agentId: String(U.agent.id), isAvailable: false } }]);
    const on = await patch('manager', U.agent.id, true);
    expect(on.status).toBe(200);
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: U.agent.id } })).isAvailable).toBe(true);
    const audit = await prismaBase.auditLog.findMany({ where: { tenantId, resource: 'delivery_partner', resourceId: String(U.agent.id), action: 'update' } });
    expect(audit).toHaveLength(2);
  });

  it('an agent switches themself only; other roles and bad values are refused', async () => {
    expect((await patch('agent2', U.agent2.id, false)).status).toBe(200);
    expect((await patch('agent2', U.agent.id, false)).status).toBe(403);
    expect((await patch('rep', U.agent.id, false)).status).toBe(403);
    expect((await patch('stock', U.agent.id, false)).status).toBe(403);
    expect((await patch('admin', U.agent.id, 'no')).status).toBe(400);
    expect((await patch('admin', U.rep.id, false)).status).toBe(404); // a rep is not a partner
    expect((await patch('admin', otherAgentId, false)).status).toBe(404); // another tenant
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: otherAgentId } })).isAvailable).toBe(true);
    await patch('admin', U.agent2.id, true);
  });

  it('the old PATCH /api/users/:id/availability route fires the same event', async () => {
    const res = await request(app).patch(`/api/users/${U.agent.id}/availability`).set(bearer(U.admin.token)).send({ isAvailable: false });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: U.agent.id, isAvailable: false });
    expect(res.body.user.role).toBeUndefined();
    expect(emitted).toEqual([{ event: 'agent:availability_changed', data: { agentId: String(U.agent.id), isAvailable: false } }]);
    await request(app).patch(`/api/users/${U.agent.id}/availability`).set(bearer(U.admin.token)).send({ isAvailable: true });
  });
});

describe('assignment skips an unavailable partner (F-709)', () => {
  it('round robin and weighted selection never return the away partner', async () => {
    const all = await prismaBase.user.findMany({ where: { tenantId, role: 'delivery_agent' } });
    expect(all.map((u) => u.id)).toContain(U.away.id);
    for (let i = 0; i < 6; i++) expect(assignmentService.selectUserRoundRobin(all, 'dpw')!.id).not.toBe(U.away.id);
    for (let i = 0; i < 6; i++) expect(assignmentService.selectUserWeighted(all, { [U.away.id]: 1 })!.id).not.toBe(U.away.id);
    expect(assignmentService.selectUserRoundRobin(all.filter((u) => u.id === U.away.id), 'dpw-only-away')).toBeNull();
  });

  it('manual assign refuses the away partner with PARTNER_UNAVAILABLE', async () => {
    const orderId = await mkOrder('confirmed');
    const res = await request(app).patch(`/api/orders/${orderId}/assign-agent`).set(bearer(U.admin.token)).send({ deliveryAgentId: U.away.id });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PARTNER_UNAVAILABLE');
    await expect(
      runInTenant(tenantId, () => assignmentService.assignByRole(orderId, U.away.id, 'delivery_agent', { kind: 'user', userId: U.admin.id }, { checkAvailable: true })),
    ).rejects.toMatchObject({ errorCode: 'PARTNER_UNAVAILABLE' });
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: orderId } })).deliveryAgentId).toBeNull();
  });

  it('a workflow assign_user action skips the away partner, and assigns nobody when only away partners are listed', async () => {
    const orderId = await mkOrder('confirmed');
    const action = (ids: number[]) => ({ type: 'assign_user', config: { userType: 'delivery_agent', distributionMode: 'even', assignments: ids.map((userId) => ({ userId, weight: 1 })) } });
    const none = await runInTenant(tenantId, () => executeAction(action([U.away.id]), { orderId }));
    expect(none.assigned).toBe(0);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: orderId } })).deliveryAgentId).toBeNull();
    const some = await runInTenant(tenantId, () => executeAction(action([U.away.id, U.agent.id]), { orderId }));
    expect(some.assigned).toBe(1);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: orderId } })).deliveryAgentId).toBe(U.agent.id);
  });

  it('a workflow assign_user action in the service picks only available users, weighted or even', async () => {
    for (const distributionMode of ['even', 'weighted']) {
      const orderId = await mkOrder('confirmed');
      const result = await runInTenant(tenantId, () => (workflowService as any).executeAssignUserAction(
        { config: { userType: 'delivery_agent', distributionMode, assignments: [{ userId: U.away.id, weight: 0.9 }, { userId: U.agent.id, weight: 0.1 }] } },
        { orderId },
      ));
      expect([distributionMode, result.assignedUserId]).toEqual([distributionMode, U.agent.id]);
    }
    const orderId = await mkOrder('confirmed');
    await expect(runInTenant(tenantId, () => (workflowService as any).executeAssignUserAction(
      { config: { userType: 'delivery_agent', assignments: [{ userId: U.away.id, weight: 1 }] } }, { orderId },
    ))).rejects.toThrow(/No available users/);
  });

  it('a workflow assign_agent action naming the away partner is refused', async () => {
    const orderId = await mkOrder('confirmed');
    await expect(runInTenant(tenantId, () => executeAction({ type: 'assign_agent', config: { agentId: U.away.id } }, { orderId })))
      .rejects.toMatchObject({ errorCode: 'PARTNER_UNAVAILABLE' });
    await expect(runInTenant(tenantId, () => (workflowService as any).executeAssignAgent({ agentId: U.away.id }, { orderId })))
      .rejects.toMatchObject({ errorCode: 'PARTNER_UNAVAILABLE' });
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: orderId } })).deliveryAgentId).toBeNull();
  });
});

describe('no coverage, no resolve, no fallback flag (decision O4)', () => {
  it('the routes do not exist', async () => {
    const h = bearer(U.admin.token);
    for (const p of ['coverage', 'resolve']) {
      expect([p, (await request(app).get(`/api/delivery-partners/${p}`).set(h)).status]).toEqual([p, 404]);
      expect([p, (await request(app).put(`/api/delivery-partners/${p}`).set(h).send({})).status]).toEqual([p, 404]);
    }
  });

  it('grep: nothing in the partner code or the schema names coverage, resolve or a fallback flag', () => {
    const root = path.join(__dirname, '../../..');
    const files = [
      'src/routes/deliveryPartnerRoutes.ts', 'src/controllers/deliveryPartnerController.ts',
      'src/services/deliveryPartnerService.ts', 'src/services/deliveryPartnerAdminService.ts',
    ].map((f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''));
    // "resolve" as a route word ('/resolve'), not resolveTenantId
    for (const text of files) expect(text).not.toMatch(/coverage|fallback|['"`/]resolve['"`/?]/i);
    const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
    const profile = schema.slice(schema.indexOf('model DeliveryPartnerProfile'), schema.indexOf('model DeliveryAttempt'));
    expect(profile).not.toMatch(/fallback|coverage/i);
    expect(schema).not.toMatch(/model PartnerCoverage/);
  });
});

describe('region normalisation (O3)', () => {
  const create = (deliveryState: string) => request(app).post('/api/orders').set(bearer(U.admin.token)).send({
    customerName: 'Abena Owusu', customerPhone: `+23327${String(Date.now()).slice(-7)}`,
    orderItems: [{ productId, quantity: 1, unitPrice: 50 }], totalAmount: 50,
    deliveryAddress: '12 Oak St', deliveryState, deliveryArea: 'Adum',
  });
  const stored = async (id: number) => {
    const o = await prismaBase.order.findUniqueOrThrow({ where: { id }, include: { customer: true } });
    return { order: o.deliveryState, customer: o.customer.state };
  };

  it('"Greater Accra Region" is stored as "Greater Accra" on the order and the customer', async () => {
    const res = await create('Greater Accra Region');
    expect(res.status).toBe(201);
    expect(await stored(res.body.order?.id ?? res.body.id)).toEqual({ order: 'Greater Accra', customer: 'Greater Accra' });
  });

  it.each([
    ['ashanti', 'Ashanti'],
    ['  Western Region ', 'Western'],
    ['Greater Accra (Tema)', 'Greater Accra'],
  ])('%s is stored as %s', async (input, expected) => {
    const res = await create(input);
    expect(res.status).toBe(201);
    expect((await stored(res.body.order?.id ?? res.body.id)).order).toBe(expected);
  });

  it('an unknown value is kept as typed and shows in the review list; a mapped one does not', async () => {
    const res = await create('Accra Central');
    expect(res.status).toBe(201);
    expect((await stored(res.body.order?.id ?? res.body.id)).order).toBe('Accra Central');
    // an old order saved before normalisation, and a digital-less blank one
    await mkOrder('confirmed', { deliveryState: 'Greater Accra Region' });
    await mkOrder('confirmed', { deliveryState: null });
    const review = await request(app).get('/api/delivery-partners/region-review').set(bearer(U.admin.token));
    expect(review.status).toBe(200);
    const byValue = Object.fromEntries(review.body.regions.map((r: any) => [r.value, r]));
    expect(byValue['Accra Central']).toMatchObject({ orders: 1, suggestion: null });
    expect(byValue['Greater Accra Region']).toMatchObject({ orders: 1, suggestion: 'Greater Accra' });
    expect(byValue['(blank)']).toMatchObject({ orders: 1, suggestion: null });
    expect(byValue['Greater Accra']).toBeUndefined();
    expect(byValue['Ashanti']).toBeUndefined();
  });

  it('the review list holds this tenant only and is for owner, admin and manager', async () => {
    const otherCustomer = (await prismaBase.customer.create({
      data: { firstName: 'O', lastName: 'T', phoneNumber: `+2332${String(SUFFIX + 1).slice(-8)}`, address: 'x', state: 'Lagos', area: 'x', tenantId: otherTenantId },
    })).id;
    await prismaBase.order.create({
      data: { customerId: otherCustomer, status: 'confirmed', subtotal: 1, totalAmount: 1, codAmount: 1, deliveryAddress: 'x', deliveryState: 'Region of the other tenant', deliveryArea: 'x', tenantId: otherTenantId } as any,
    });
    const review = await request(app).get('/api/delivery-partners/region-review').set(bearer(U.manager.token));
    expect(review.status).toBe(200);
    expect(JSON.stringify(review.body)).not.toContain('other tenant');
    for (const who of ['stock', 'rep', 'agent']) expect([who, (await request(app).get('/api/delivery-partners/region-review').set(bearer(U[who].token))).status]).toEqual([who, 403]);
  });
});
