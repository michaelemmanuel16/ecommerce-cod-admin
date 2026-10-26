/**
 * M5-T05 (COD-48): fee rule service and API, and the fee stamp inside the order state machine (F-703, F-936).
 * One throwaway tenant and one other tenant on the test DB.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { runInTenant } from '../../utils/tenantContext';
import { transitionOrder, TransitionActor } from '../../services/orderStateMachine';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const ADMIN: TransitionActor = { kind: 'user', userId: undefined, role: 'super_admin' };
let tenantId: string;
let otherTenantId: string;
let customerId: number;
let kofiId: number;
let logiswiftId: number;
let noRuleId: number;
let otherPartnerId: number;
const T: Record<string, string> = {};

const mkUser = async (label: string, role: any, extra: Record<string, unknown> = {}, tid = tenantId) => {
  const u = await prismaBase.user.create({
    data: { email: `fr-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'T', role, tenantId: tid, ...extra },
  });
  T[label] = generateAccessToken({ id: u.id, email: u.email, role, tenantId: tid });
  return u;
};
const mk = async (partnerId: number | null, status: any, extra: Record<string, unknown> = {}) =>
  (await prismaBase.order.create({
    data: { customerId, status, subtotal: 200, totalAmount: 200, codAmount: 200, deliveryAgentId: partnerId, tenantId, ...extra } as any,
  })).id;
const move = (id: number, to: any, options: any = {}) => runInTenant(tenantId, () => transitionOrder(id, to, ADMIN, options));
const orderOf = (id: number) => prismaBase.order.findUniqueOrThrow({ where: { id } });
const rule = (partnerUserId: number, outcome: any, amount: number, validFrom = '2026-01-01', basis: any = 'flat') =>
  prismaBase.feeRule.create({ data: { tenantId, partnerUserId, outcome, amount, basis, validFrom: new Date(`${validFrom}T00:00:00.000Z`) } });
const missingFindings = (partnerId: number) =>
  prismaBase.finding.findMany({ where: { tenantId, type: 'fee_rule_missing', subjectType: 'delivery_partner', subjectId: { startsWith: `${partnerId}:` } } });
const api = {
  get: (who: string, partnerId: number) => request(app).get(`/api/delivery-partners/${partnerId}/fee-rules`).set(bearer(T[who])),
  post: (who: string, partnerId: number, body: Record<string, unknown>) =>
    request(app).post(`/api/delivery-partners/${partnerId}/fee-rules`).set(bearer(T[who])).send(body),
};

beforeAll(async () => {
  tenantId = (await createTenant('Fee Rules')).id;
  otherTenantId = (await createTenant('Fee Rules Other')).id;
  await seedTenantDefaults(tenantId);
  await seedTenantDefaults(otherTenantId);
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-8)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  ADMIN.userId = (await mkUser('owner', 'super_admin')).id;
  await mkUser('admin', 'admin');
  await mkUser('manager', 'manager');
  await mkUser('clerk', 'accountant');
  await mkUser('stock', 'inventory_manager');
  kofiId = (await mkUser('kofi', 'delivery_agent', { kind: 'person' })).id;
  logiswiftId = (await mkUser('logiswift', 'delivery_agent', { kind: 'company' })).id;
  noRuleId = (await mkUser('norule', 'delivery_agent', { kind: 'person' })).id;
  otherPartnerId = (await mkUser('other', 'delivery_agent', { kind: 'person' }, otherTenantId)).id;
  // Fixture rules: Kofi 25 delivered and 5 failed. Logiswift 35 delivered and 0 failed.
  await rule(kofiId, 'delivered', 25);
  await rule(kofiId, 'failed', 5);
  await rule(logiswiftId, 'delivered', 35);
  await rule(logiswiftId, 'failed', 0);
}, 60000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('GET and POST /api/delivery-partners/:id/fee-rules', () => {
  it('lists the history and the rule in force for each outcome', async () => {
    const res = await api.get('clerk', kofiId);
    expect(res.status).toBe(200);
    expect(res.body.current.delivered).toMatchObject({ amount: '25.00', basis: 'flat' });
    expect(res.body.current.failed.amount).toBe('5.00');
    expect(res.body.current.returned).toBeNull();
    expect(res.body.rules).toHaveLength(2);
  });

  it('shows the weighted fee: the average fee stamped on the partner\'s delivered orders (R5)', async () => {
    const wf = await mkUser('wfpartner', 'delivery_agent');
    expect(await api.get('owner', wf.id).then((r) => [r.body.weightedFee, r.body.deliveredOrders])).toEqual([null, 0]);
    await mk(wf.id, 'delivered', { deliveryFee: 20 });
    await mk(wf.id, 'delivered', { deliveryFee: 30 });
    await mk(wf.id, 'failed_delivery', { deliveryFee: 5 });
    const res = await api.get('owner', wf.id);
    expect(res.body.weightedFee).toBe('25.00');
    expect(res.body.deliveredOrders).toBe(2);
  });

  it('owner and admin may add a rule; manager and clerk may only read', async () => {
    const created = await api.post('admin', kofiId, { outcome: 'returned', amount: '3', validFrom: '2026-02-01' });
    expect(created.status).toBe(201);
    expect(created.body.rule).toMatchObject({ outcome: 'returned', basis: 'flat', amount: '3.00', validFrom: '2026-02-01' });
    expect((await api.post('manager', kofiId, { outcome: 'returned', amount: 1, validFrom: '2026-03-01' })).status).toBe(403);
    expect((await api.post('clerk', kofiId, { outcome: 'returned', amount: 1, validFrom: '2026-03-01' })).status).toBe(403);
    expect((await api.get('manager', kofiId)).status).toBe(200);
    expect((await api.get('stock', kofiId)).status).toBe(403);
  });

  it('a newer rule becomes the current one and the history keeps the old one', async () => {
    expect((await api.post('owner', logiswiftId, { outcome: 'delivered', amount: 30, validFrom: '2026-06-01' })).status).toBe(201);
    const res = await api.get('owner', logiswiftId);
    expect(res.body.current.delivered.amount).toBe('30.00');
    expect(res.body.rules.filter((r: any) => r.outcome === 'delivered').map((r: any) => r.amount)).toEqual(['30.00', '35.00']);
  });

  it('rejects percent above 100, a negative amount, a bad outcome and a bad date', async () => {
    const percent = await api.post('owner', noRuleId, { outcome: 'delivered', basis: 'percent', amount: 101, validFrom: '2026-01-01' });
    expect(percent.status).toBe(400);
    expect(percent.body.errorCode ?? percent.body.code).toBe('PERCENT_TOO_HIGH');
    expect((await api.post('owner', noRuleId, { outcome: 'delivered', amount: -1 })).status).toBe(400);
    expect((await api.post('owner', noRuleId, { outcome: 'lost', amount: 1 })).status).toBe(400);
    expect((await api.post('owner', noRuleId, { outcome: 'delivered', amount: 1, validFrom: '2026-02-31' })).status).toBe(400);
    expect(await prismaBase.feeRule.count({ where: { partnerUserId: noRuleId } })).toBe(0);
  });

  it('rejects two rules with the same outcome and valid-from', async () => {
    const res = await api.post('owner', kofiId, { outcome: 'delivered', amount: 26, validFrom: '2026-01-01' });
    expect(res.status).toBe(409);
    expect(await prismaBase.feeRule.count({ where: { partnerUserId: kofiId, outcome: 'delivered' } })).toBe(1);
  });

  it('saves several outcomes in one request and answers with the list as GET gives it', async () => {
    const partner = await mkUser('batch', 'delivery_agent');
    const res = await api.post('owner', partner.id, { rules: [
      { outcome: 'delivered', amount: 25, validFrom: '2026-01-01' },
      { outcome: 'failed', amount: 5, validFrom: '2026-01-01' },
    ] });
    expect(res.status).toBe(201);
    expect(res.body.current.delivered).toMatchObject({ amount: '25.00', basis: 'flat' });
    expect(res.body.current.failed).toMatchObject({ amount: '5.00' });
    expect(res.body.current.returned).toBeNull();
    expect(res.body.rules).toHaveLength(2);
    expect(res.body).toHaveProperty('weightedFee');
    expect(await prismaBase.auditLog.count({ where: { tenantId, resource: 'fee_rule', action: 'create', resourceId: { in: res.body.rules.map((r: any) => String(r.id)) } } })).toBe(2);
  });

  it('a same-date conflict comes back per outcome and nothing at all is stored (one transaction)', async () => {
    const partner = await mkUser('batchconflict', 'delivery_agent');
    await rule(partner.id, 'delivered', 25, '2026-03-01');
    const res = await api.post('owner', partner.id, { rules: [
      { outcome: 'delivered', amount: 30, validFrom: '2026-03-01' },
      { outcome: 'failed', amount: 5, validFrom: '2026-03-01' },
    ] });
    expect(res.status).toBe(409);
    expect(res.body.errors).toEqual({ delivered: 'This partner already has a delivered fee rule from 2026-03-01' });
    expect(res.body.error).toBe(res.body.errors.delivered);
    expect(await prismaBase.feeRule.count({ where: { partnerUserId: partner.id } })).toBe(1);
  });

  it('a bad value in a batch is reported on its outcome, and the same outcome twice is refused', async () => {
    const partner = await mkUser('batchbad', 'delivery_agent');
    const bad = await api.post('owner', partner.id, { rules: [{ outcome: 'delivered', basis: 'percent', amount: 101 }, { outcome: 'failed', amount: 2 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toEqual({ delivered: 'A percent fee cannot be above 100' });
    const twice = await api.post('owner', partner.id, { rules: [{ outcome: 'failed', amount: 2 }, { outcome: 'failed', amount: 3 }] });
    expect(twice.status).toBe(400);
    expect(twice.body.errors.failed).toMatch(/only once/);
    expect(await prismaBase.feeRule.count({ where: { partnerUserId: partner.id } })).toBe(0);
    expect((await api.post('manager', partner.id, { rules: [{ outcome: 'failed', amount: 2 }] })).status).toBe(403);
  });

  it('valid-from defaults to today and writes one audit row', async () => {
    const res = await api.post('owner', noRuleId, { outcome: 'failed', amount: 2 });
    expect(res.status).toBe(201);
    expect(res.body.rule.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await prismaBase.auditLog.count({ where: { tenantId, resource: 'fee_rule', resourceId: String(res.body.rule.id) } })).toBe(1);
    await prismaBase.feeRule.deleteMany({ where: { partnerUserId: noRuleId } });
  });

  it('another tenant: the partner is not found, and our rules never show', async () => {
    expect((await api.get('owner', otherPartnerId)).status).toBe(404);
    expect((await api.post('owner', otherPartnerId, { outcome: 'delivered', amount: 1 })).status).toBe(404);
  });
});

describe('fee stamp in the order state machine', () => {
  it('Kofi delivered stamps GH25 once; a repeat call and a later rule change leave it alone', async () => {
    const id = await mk(kofiId, 'out_for_delivery');
    const first = await move(id, 'delivered');
    expect(first.changed).toBe(true);
    let order = await orderOf(id);
    expect(Number(order.deliveryFee)).toBe(25);
    expect(order.deliveryFeeSource).toBe('rule');

    await rule(kofiId, 'delivered', 99, '2026-07-01');
    const again = await move(id, 'delivered');
    expect(again.changed).toBe(false);
    order = await orderOf(id);
    expect(Number(order.deliveryFee)).toBe(25);
    await prismaBase.feeRule.deleteMany({ where: { partnerUserId: kofiId, amount: 99 } });
  });

  it('Kofi failed stamps GH5 and Logiswift failed stamps 0, with no Finding for either', async () => {
    const kofi = await mk(kofiId, 'out_for_delivery');
    await move(kofi, 'failed_delivery', { failureReason: 'not_reachable' });
    expect(Number((await orderOf(kofi)).deliveryFee)).toBe(5);

    const logi = await mk(logiswiftId, 'out_for_delivery');
    await move(logi, 'failed_delivery', { failureReason: 'not_reachable' });
    const order = await orderOf(logi);
    expect(Number(order.deliveryFee)).toBe(0);
    expect(order.deliveryFeeSource).toBe('rule');
    expect(await missingFindings(kofiId)).toHaveLength(0);
    expect(await missingFindings(logiswiftId)).toHaveLength(0);
  });

  it('a failed order that is delivered later carries the delivered fee', async () => {
    const id = await mk(kofiId, 'out_for_delivery');
    await move(id, 'failed_delivery', { failureReason: 'not_reachable' });
    await move(id, 'out_for_delivery');
    await move(id, 'delivered');
    expect(Number((await orderOf(id)).deliveryFee)).toBe(25);
  });

  it('a partner with no rule stamps 0 and raises fee_rule_missing once a day', async () => {
    const a = await mk(noRuleId, 'out_for_delivery');
    const b = await mk(noRuleId, 'out_for_delivery');
    await move(a, 'delivered');
    await move(b, 'failed_delivery', { failureReason: 'not_reachable' });
    expect(Number((await orderOf(a)).deliveryFee)).toBe(0);
    expect(Number((await orderOf(b)).deliveryFee)).toBe(0);
    expect(await missingFindings(noRuleId)).toHaveLength(1);
  });

  it('a partner with a delivered rule but no return rule stamps 0 on return and raises nothing', async () => {
    const id = await mk(logiswiftId, 'out_for_delivery');
    await move(id, 'delivered');
    expect(Number((await orderOf(id)).deliveryFee)).toBe(30);
    await move(id, 'returned');
    expect(Number((await orderOf(id)).deliveryFee)).toBe(0);
    expect(await missingFindings(logiswiftId)).toHaveLength(0);
  });

  it('the rule valid on the outcome date applies: a back-dated delivery uses the older rule', async () => {
    const old = await mk(logiswiftId, 'out_for_delivery');
    await move(old, 'delivered', { deliveryDate: new Date('2026-03-10T12:00:00.000Z') });
    expect(Number((await orderOf(old)).deliveryFee)).toBe(35);
    const recent = await mk(logiswiftId, 'out_for_delivery');
    await move(recent, 'delivered', { deliveryDate: new Date('2026-06-10T12:00:00.000Z') });
    expect(Number((await orderOf(recent)).deliveryFee)).toBe(30);
  });

  it('a percent rule takes its share of the order total', async () => {
    const pct = (await mkUser('pct', 'delivery_agent', { kind: 'person' })).id;
    await rule(pct, 'delivered', 12.5, '2026-01-01', 'percent');
    const id = await mk(pct, 'out_for_delivery');
    await move(id, 'delivered');
    expect(Number((await orderOf(id)).deliveryFee)).toBe(25);
  });

  it('an order with no partner stamps 0 and raises nothing', async () => {
    const before = await prismaBase.finding.count({ where: { tenantId, type: 'fee_rule_missing' } });
    const jump = await mk(null, 'out_for_delivery');
    await move(jump, 'failed_delivery', { failureReason: 'not_reachable' });
    expect(Number((await orderOf(jump)).deliveryFee)).toBe(0);
    expect(await prismaBase.finding.count({ where: { tenantId, type: 'fee_rule_missing' } })).toBe(before);
  });
});
