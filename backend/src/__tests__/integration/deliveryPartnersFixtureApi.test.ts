/**
 * M4-T18 (COD-42): the partners read API on the NUMBERS.md fixture. Seeds the fixture once, then reads
 * GET /api/delivery-partners, /summary, /waiting and /failure-reasons through HTTP.
 * Fee rules and profiles are not in the fixture yet: this suite adds the few it needs (and turns the two 3PLs into companies).
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { bearer } from './helpers/superAdminToken';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';

jest.setTimeout(240_000);

const RANGE = 'from=2026-10-01&to=2026-10-17';
const SUFFIX = Date.now();

let tenantId: string;
const token: Record<string, string> = {};
const idOf: Record<string, number> = {};

const mkUser = async (role: any, label: string) => {
  const u = await prismaBase.user.create({
    data: { email: `dpf-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'T', role, tenantId },
  });
  return generateAccessToken({ id: u.id, email: u.email, role, tenantId });
};

beforeAll(async () => {
  tenantId = (await seedFixture(prismaBase)).tenantId;
  const admin = await prismaBase.user.findFirstOrThrow({ where: { tenantId, role: 'admin' } });
  token.admin = generateAccessToken({ id: admin.id, email: admin.email, role: 'admin', tenantId });
  token.manager = await mkUser('manager', 'manager');
  token.accountant = await mkUser('accountant', 'acct');
  token.inventory_manager = await mkUser('inventory_manager', 'stock');
  token.sales_rep = await mkUser('sales_rep', 'rep');
  token.delivery_agent = await mkUser('delivery_agent', 'agent');

  // The two 3PLs are companies (tabs 5 / 3 / 2). The fixture creates every user as a person.
  await prismaBase.user.updateMany({ where: { tenantId, firstName: { in: ['Logiswift', 'Kasapa'] } }, data: { kind: 'company' } });
  for (const first of ['Logiswift', 'Kofi', 'Esi', 'Kwesi', 'Kasapa']) {
    idOf[first] = (await prismaBase.user.findFirstOrThrow({ where: { tenantId, firstName: first } })).id;
  }
  // Kasapa is a trial partner with a profile; Kofi has a fee rule (NUMBERS.md: 25 delivered, 5 failed, 0 returned)
  await prismaBase.deliveryPartnerProfile.create({ data: { tenantId, userId: idOf.Kasapa, isTrial: true, daysToPay: 7, baseTown: 'Cape Coast', dataSource: 'csv' } });
  await prismaBase.feeRule.createMany({
    data: [
      { tenantId, partnerUserId: idOf.Kofi, outcome: 'delivered', amount: '25' },
      { tenantId, partnerUserId: idOf.Kofi, outcome: 'failed', amount: '5' },
      { tenantId, partnerUserId: idOf.Kofi, outcome: 'returned', amount: '0' },
    ],
  });
});

afterAll(async () => {
  await prismaBase.feeRule.deleteMany({ where: { tenantId } });
  await prismaBase.deliveryPartnerProfile.deleteMany({ where: { tenantId } });
  await prismaBase.auditLog.deleteMany({ where: { tenantId } });
  await prismaBase.user.deleteMany({ where: { tenantId, email: { endsWith: `-${SUFFIX}@codadmin.test` } } });
  await deleteFixtureRows(prismaBase, tenantId);
  await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  await prismaBase.$disconnect();
});

const rowOf = (body: any, first: string) => body.rows.find((r: any) => r.name.startsWith(first));

describe('GET /api/delivery-partners (F-700, F-702)', () => {
  it('rows and total equal NUMBERS.md', async () => {
    const res = await request(app).get(`/api/delivery-partners?${RANGE}`).set(bearer(token.admin));
    expect(res.status).toBe(200);
    const want: Array<[string, number, number, number, number, number | null]> = [
      ['Logiswift', 590, 220, 270, 100, 45],
      ['Kofi', 172, 82, 70, 20, 54],
      ['Esi', 102, 48, 40, 14, 55],
      ['Kwesi', 54, 26, 22, 6, 54],
      ['Kasapa', 8, 0, 0, 8, null],
    ];
    for (const [first, assigned, delivered, failedOrReturned, outNow, success] of want) {
      const r = rowOf(res.body, first);
      expect([first, r.assigned, r.delivered, r.failedOrReturned, r.outNow]).toEqual([first, assigned, delivered, failedOrReturned, outNow]);
      expect(r.deliverySuccessRate.value === null ? null : Math.round(r.deliverySuccessRate.value)).toBe(success);
    }
    const t = res.body.total;
    expect([t.assigned, t.delivered, t.failedOrReturned, t.outNow]).toEqual([926, 376, 402, 148]);
    expect(Math.round(t.deliverySuccessRate.value)).toBe(48);
    expect(t.failed).toBe(354);
    expect(t.returned).toBe(48);
  });

  it('delivered + failed or returned + out now equals assigned on every row and in the total', async () => {
    const res = await request(app).get(`/api/delivery-partners?${RANGE}`).set(bearer(token.admin));
    for (const r of [...res.body.rows, res.body.total]) {
      expect(r.delivered + r.failedOrReturned + r.outNow).toBe(r.assigned);
      expect(r.failed + r.returned).toBe(r.failedOrReturned);
      expect(r.notYetDispatched).toBe(0);
    }
  });

  it('medians, base town, trial tag, data source and the M5 columns', async () => {
    const res = await request(app).get(`/api/delivery-partners?${RANGE}`).set(bearer(token.admin));
    expect([rowOf(res.body, 'Logiswift').confirmedToDispatchedDays, rowOf(res.body, 'Logiswift').dispatchedToDeliveredDays]).toEqual([1.4, 3.8]);
    expect([rowOf(res.body, 'Kofi').confirmedToDispatchedDays, rowOf(res.body, 'Kofi').dispatchedToDeliveredDays]).toEqual([0.6, 1.2]);
    expect(rowOf(res.body, 'Kasapa')).toMatchObject({ isTrial: true, baseTown: 'Cape Coast', dataSource: 'csv', type: '3pl' });
    expect(rowOf(res.body, 'Kofi')).toMatchObject({ isTrial: false, dataSource: 'app', type: 'agent' });
    for (const r of res.body.rows) expect([r.cashHeld, r.oldestUnpaidDays]).toEqual([null, null]);
  });

  it('tabs: 5 / 3 / 2 (plus this suite\'s own agent with no orders), and type filters the rows and the total', async () => {
    const all = await request(app).get(`/api/delivery-partners?${RANGE}`).set(bearer(token.admin));
    expect(all.body.counts).toEqual({ all: 6, agent: 4, '3pl': 2 });
    const idle = all.body.rows.find((r: any) => r.name.startsWith('agent'));
    expect([idle.assigned, idle.delivered, idle.failedOrReturned, idle.outNow, idle.deliverySuccessRate.value]).toEqual([0, 0, 0, 0, null]);
    const tpl = await request(app).get(`/api/delivery-partners?${RANGE}&type=3pl`).set(bearer(token.admin));
    expect(tpl.body.rows.map((r: any) => r.name.split(' ')[0]).sort()).toEqual(['Kasapa', 'Logiswift']);
    expect(tpl.body.total.assigned).toBe(598);
    expect(tpl.body.counts).toEqual({ all: 6, agent: 4, '3pl': 2 });
    const agents = await request(app).get(`/api/delivery-partners?${RANGE}&type=agent`).set(bearer(token.admin));
    expect(agents.body.rows).toHaveLength(4);
    expect(agents.body.total.assigned).toBe(328);
    expect((await request(app).get(`/api/delivery-partners?${RANGE}&type=bad`).set(bearer(token.admin))).status).toBe(400);
  });

  it('fee rule is read from FeeRule and shown to a role with financial:view only', async () => {
    const admin = await request(app).get(`/api/delivery-partners?${RANGE}`).set(bearer(token.admin));
    expect(rowOf(admin.body, 'Kofi').feeRule).toEqual({ delivered: '25.00', failed: '5.00', returned: '0.00' });
    expect(rowOf(admin.body, 'Esi').feeRule).toBeNull();
    const acct = await request(app).get(`/api/delivery-partners?${RANGE}`).set(bearer(token.accountant));
    expect(rowOf(acct.body, 'Kofi').feeRule).toEqual({ delivered: '25.00', failed: '5.00', returned: '0.00' });
    const stock = await request(app).get(`/api/delivery-partners?${RANGE}`).set(bearer(token.inventory_manager));
    expect(stock.status).toBe(200);
    expect(JSON.stringify(stock.body)).not.toContain('feeRule');
    expect(rowOf(stock.body, 'Kofi').assigned).toBe(172);
  });

  it('no from and to means this month; from after to is 400; a bad date is 400', async () => {
    expect((await request(app).get('/api/delivery-partners').set(bearer(token.admin))).status).toBe(200);
    expect((await request(app).get('/api/delivery-partners?from=2026-10-17&to=2026-10-01').set(bearer(token.admin))).status).toBe(400);
    expect((await request(app).get('/api/delivery-partners?from=nope&to=2026-10-01').set(bearer(token.admin))).status).toBe(400);
  });

  it('roles: manager, accountant and stock keeper read; sales rep and delivery agent are refused', async () => {
    for (const role of ['manager', 'accountant', 'inventory_manager']) {
      expect([role, (await request(app).get(`/api/delivery-partners?${RANGE}`).set(bearer(token[role]))).status]).toEqual([role, 200]);
    }
    for (const role of ['sales_rep', 'delivery_agent']) {
      expect([role, (await request(app).get(`/api/delivery-partners?${RANGE}`).set(bearer(token[role]))).status]).toEqual([role, 403]);
    }
    expect((await request(app).get(`/api/delivery-partners?${RANGE}`)).status).toBe(401);
  });
});

describe('GET /api/delivery-partners/summary (F-701)', () => {
  it('five tiles', async () => {
    const res = await request(app).get(`/api/delivery-partners/summary?${RANGE}`).set(bearer(token.admin));
    expect(res.status).toBe(200);
    expect(res.body.outNow).toEqual({ orders: 148, partners: 5 });
    expect(res.body.waiting.orders).toBe(100);
    expect(typeof res.body.waiting.oldestDays).toBe('number');
    expect(res.body.delivered).toMatchObject({ orders: 376, revenue: '92000.00', currency: 'GHS' });
    expect(Math.round(res.body.deliverySuccess.rate.value)).toBe(48);
    expect(res.body.deliverySuccess.target).toBe(60);
    expect(res.body.deliverySuccess.gapPoints).toBeGreaterThan(11);
    expect(res.body.cashWithPartners).toEqual({ amount: null, overdueOrders: null });
  });

  it('the tenant\'s delivery success target is read (the fixture holds 60); with no target row the default is 60', async () => {
    const row = await prismaBase.target.findFirstOrThrow({ where: { tenantId, metric: 'delivery_success_rate', roleId: null, userId: null } });
    try {
      await prismaBase.target.update({ where: { id: row.id }, data: { value: '55' } });
      const changed = await request(app).get(`/api/delivery-partners/summary?${RANGE}`).set(bearer(token.admin));
      expect(changed.body.deliverySuccess.target).toBe(55);
      expect(changed.body.deliverySuccess.gapPoints).toBeLessThan(8);
      await prismaBase.target.delete({ where: { id: row.id } });
      const none = await request(app).get(`/api/delivery-partners/summary?${RANGE}`).set(bearer(token.admin));
      expect(none.body.deliverySuccess.target).toBe(60);
    } finally {
      await prismaBase.target.deleteMany({ where: { id: row.id } });
      await prismaBase.target.create({ data: { tenantId, scope: row.scope, metric: row.metric, unit: row.unit, value: row.value, periodStart: row.periodStart, periodEnd: row.periodEnd } });
    }
  });

  it('revenue is left out for a role without financial:view', async () => {
    const res = await request(app).get(`/api/delivery-partners/summary?${RANGE}`).set(bearer(token.inventory_manager));
    expect(res.status).toBe(200);
    expect(res.body.delivered).toEqual({ orders: 376 });
  });
});

describe('GET /api/delivery-partners/waiting (F-715)', () => {
  it('100 orders, oldest first, with age and region', async () => {
    const res = await request(app).get('/api/delivery-partners/waiting').set(bearer(token.admin));
    expect(res.status).toBe(200);
    expect(res.body.orders).toBe(100);
    expect(res.body.list).toHaveLength(100);
    const ages = res.body.list.map((o: any) => o.ageDays);
    expect([...ages].sort((a: number, b: number) => b - a)).toEqual(ages);
    expect(res.body.oldestDays).toBe(ages[0]);
    for (const o of res.body.list) {
      expect(['confirmed', 'preparing', 'ready_for_pickup']).toContain(o.status);
      expect(o.overdue).toBe(o.ageDays > res.body.overdueAfterDays);
      expect(o.total).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('limit, money left out for a role without financial:view, and the oversight roles only', async () => {
    const limited = await request(app).get('/api/delivery-partners/waiting?limit=5').set(bearer(token.manager));
    expect(limited.body.list).toHaveLength(5);
    expect(limited.body.orders).toBe(100);
    expect((await request(app).get('/api/delivery-partners/waiting?limit=0').set(bearer(token.admin))).status).toBe(400);
    expect((await request(app).get('/api/delivery-partners/waiting').set(bearer(token.accountant))).status).toBe(403);
    expect((await request(app).get('/api/delivery-partners/waiting').set(bearer(token.inventory_manager))).status).toBe(403);
  });
});

describe('GET /api/delivery-partners/failure-reasons (F-705)', () => {
  it('sums to 402 with failed 354 and returned 48 apart', async () => {
    const res = await request(app).get(`/api/delivery-partners/failure-reasons?${RANGE}`).set(bearer(token.admin));
    expect(res.status).toBe(200);
    expect([res.body.total, res.body.failed, res.body.returned]).toEqual([402, 354, 48]);
    const counts = Object.fromEntries(res.body.reasons.map((r: any) => [r.reason, r.count]));
    expect(counts).toEqual({ not_reachable: 165, refused: 96, wrong_address: 84, rescheduled: 57, other: 0 });
    expect(res.body.reasons.reduce((s: number, r: any) => s + r.count, 0)).toBe(402);
    expect(res.body.reasons.map((r: any) => Math.round(r.percent))).toEqual([41, 24, 21, 14, 0]);
  });

  it('filters by partner', async () => {
    const res = await request(app).get(`/api/delivery-partners/failure-reasons?${RANGE}&partnerId=${idOf.Logiswift}`).set(bearer(token.admin));
    expect(res.body.total).toBe(270);
    const all = await request(app).get(`/api/delivery-partners/failure-reasons?${RANGE}`).set(bearer(token.admin));
    const sum = await Promise.all(['Kofi', 'Esi', 'Kwesi', 'Kasapa', 'Logiswift'].map(async (n) =>
      (await request(app).get(`/api/delivery-partners/failure-reasons?${RANGE}&partnerId=${idOf[n]}`).set(bearer(token.admin))).body.total));
    expect(sum.reduce((a, b) => a + b, 0)).toBe(all.body.total);
    expect((await request(app).get(`/api/delivery-partners/failure-reasons?${RANGE}&partnerId=abc`).set(bearer(token.admin))).status).toBe(400);
  });

  it('a failed order with no reason counts as other', async () => {
    const o = await prismaBase.order.findFirstOrThrow({ where: { tenantId, status: 'failed_delivery', failureReason: 'refused' } });
    await prismaBase.order.update({ where: { id: o.id }, data: { failureReason: null } });
    try {
      const res = await request(app).get(`/api/delivery-partners/failure-reasons?${RANGE}`).set(bearer(token.admin));
      const counts = Object.fromEntries(res.body.reasons.map((r: any) => [r.reason, r.count]));
      expect([counts.refused, counts.other, res.body.total]).toEqual([95, 1, 402]);
    } finally {
      await prismaBase.order.update({ where: { id: o.id }, data: { failureReason: 'refused' } });
    }
  });
});
