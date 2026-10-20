/**
 * M1-T22 (F-755): time to first call. Service numbers, GET /api/rep/stats/time-to-first-call (role scope, tenant),
 * and PUT /api/admin/settings operatingHours (shape check). Two throwaway tenants on the test DB; Accra is UTC+0.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { makeOrder, makeUser, KpiOrderInput } from './helpers/kpiOrders';
import { timeToFirstCall } from '../../services/kpi/timeToFirstCall';

let pair: TwoTenants;
let superToken: string;
let tenantId: string;
let customerId: number;
let repId: number;
let otherRepId: number;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const d = (iso: string) => new Date(iso);

const weekday = { open: '08:00', close: '20:00', enabled: true };
const HOURS = {
  days: {
    monday: weekday, tuesday: weekday, wednesday: weekday, thursday: weekday, friday: weekday,
    saturday: { open: '09:00', close: '18:00', enabled: true },
    sunday: { open: '10:00', close: '16:00', enabled: false },
  },
  firstCallTargetMinutes: 15,
  queueWaitAlertMinutes: 30,
};

async function order(o: Omit<KpiOrderInput, 'tenantId' | 'customerId'> & { firstContactAt?: Date; callSource?: 'manual' | 'auto_confirm' }) {
  const { firstContactAt, callSource, ...rest } = o;
  const created = await makeOrder({ tenantId, customerId, ...rest });
  if (firstContactAt) await prismaBase.order.update({ where: { id: created.id }, data: { firstContactAt } });
  if (callSource) {
    await prismaBase.call.create({
      data: { orderId: created.id, customerId, salesRepId: repId, outcome: 'confirmed', source: callSource, createdAt: firstContactAt, tenantId },
    });
  }
  return created;
}

beforeAll(async () => {
  pair = await createTwoTenants('kpittfc');
  tenantId = pair.a.id;
  customerId = pair.a.ids.customer;
  repId = pair.a.users.salesRep.id;
  otherRepId = pair.a.users.admin.id;
  const sa = await makeUser(tenantId, 'super', 'super_admin');
  superToken = generateAccessToken({ id: sa.id, email: sa.email, role: 'super_admin', tenantId });

  // Tuesday 6 Oct 2026. Range 5 to 6 Oct by order date.
  // O1: rep's order placed 22:30 Mon... use Tue 22:30, first call Wed 08:12 -> 12 working minutes (582 wall).
  await order({ status: 'confirmed', customerRepId: repId, createdAt: d('2026-10-06T22:30:00Z'), firstContactAt: d('2026-10-07T08:12:00Z'), callSource: 'manual' });
  // O2: other rep's order, 20 minutes inside hours.
  await order({ status: 'confirmed', customerRepId: otherRepId, createdAt: d('2026-10-06T10:00:00Z'), firstContactAt: d('2026-10-06T10:20:00Z'), callSource: 'manual' });
  // O3: closed by the customer's YES (auto-confirm): counted apart.
  await order({ status: 'confirmed', customerRepId: repId, createdAt: d('2026-10-06T11:00:00Z'), firstContactAt: d('2026-10-06T11:01:00Z'), callSource: 'auto_confirm' });
  // O4: nobody called yet.
  await order({ status: 'pending_confirmation', customerRepId: repId, createdAt: d('2026-10-06T12:00:00Z') });
  // O5: digital order: out of scope.
  await order({ status: 'digital_delivered', paymentStatus: 'paid', createdAt: d('2026-10-06T12:00:00Z'), firstContactAt: d('2026-10-06T12:05:00Z') });
}, 60000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('timeToFirstCall (hours not set)', () => {
  it('counts wall minutes and says the hours are not set', async () => {
    const r = await timeToFirstCall(tenantId, d('2026-10-06T00:00:00Z'), d('2026-10-07T00:00:00Z'));
    // wall minutes: O1 582, O2 20 -> median 301
    expect(r).toMatchObject({ value: 301, unit: 'minutes', dateBasis: 'createdAt', formulaId: 'rep.timeToFirstCall.v1', operatingHoursSet: false, targetMinutes: null, alertMinutes: null });
    expect(r.detail).toEqual({ measured: 2, autoConfirmed: 1, noContact: 1, placed: 4 });
  });
});

describe('PUT /api/admin/settings operatingHours', () => {
  it('rejects a bad shape with 400 and stores nothing', async () => {
    const res = await request(app).put('/api/admin/settings').set(auth(superToken))
      .send({ operatingHours: { days: { monday: { open: '20:00', close: '08:00', enabled: true } } } });
    expect(res.status).toBe(400);
    expect(res.body.code ?? res.body.error?.code ?? JSON.stringify(res.body)).toMatch(/INVALID_OPERATING_HOURS/);
    const cfg = await prismaBase.systemConfig.findUniqueOrThrow({ where: { tenantId } });
    expect(cfg.operatingHours).toBeNull();
  });

  it('a non-super-admin cannot set it', async () => {
    const res = await request(app).put('/api/admin/settings').set(auth(pair.a.users.admin.token)).send({ operatingHours: HOURS });
    expect(res.status).toBe(403);
  });

  it('accepts a good shape', async () => {
    const res = await request(app).put('/api/admin/settings').set(auth(superToken)).send({ operatingHours: HOURS });
    expect(res.status).toBe(200);
    const cfg = await prismaBase.systemConfig.findUniqueOrThrow({ where: { tenantId } });
    expect(cfg.operatingHours).toEqual(HOURS);
  });
});

describe('timeToFirstCall (hours set)', () => {
  it('22:30 order, 08:12 call = 12 working minutes; median of 12 and 20 = 16; target and alert come back', async () => {
    const r = await timeToFirstCall(tenantId, d('2026-10-06T00:00:00Z'), d('2026-10-07T00:00:00Z'));
    expect(r).toMatchObject({ value: 16, operatingHoursSet: true, targetMinutes: 15, alertMinutes: 30 });
    expect(r.detail).toMatchObject({ measured: 2, autoConfirmed: 1, noContact: 1 });
  });

  it('filters by rep (customerRepId)', async () => {
    const r = await timeToFirstCall(tenantId, d('2026-10-06T00:00:00Z'), d('2026-10-07T00:00:00Z'), { repId });
    expect(r.value).toBe(12);
    expect(r.detail).toMatchObject({ measured: 1, autoConfirmed: 1, noContact: 1 });
  });
});

describe('GET /api/rep/stats/time-to-first-call', () => {
  const rangeUrl = '/api/rep/stats/time-to-first-call?from=2026-10-06&to=2026-10-06';

  it('401 with no token; 400 for a bad range or repId', async () => {
    expect((await request(app).get(rangeUrl)).status).toBe(401);
    const h = auth(pair.a.users.admin.token);
    expect((await request(app).get('/api/rep/stats/time-to-first-call').set(h)).status).toBe(400);
    expect((await request(app).get('/api/rep/stats/time-to-first-call?from=2026-10-07&to=2026-10-06').set(h)).status).toBe(400);
    expect((await request(app).get(`${rangeUrl}&repId=abc`).set(h)).status).toBe(400);
  });

  it('an admin sees all orders, or one rep with repId', async () => {
    const all = await request(app).get(rangeUrl).set(auth(pair.a.users.admin.token));
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ value: 16, unit: 'minutes', operatingHoursSet: true });
    const one = await request(app).get(`${rangeUrl}&repId=${otherRepId}`).set(auth(pair.a.users.admin.token));
    expect(one.body.value).toBe(20);
  });

  it('a sales rep sees only their own orders, whatever repId says (cannot read another rep)', async () => {
    const own = await request(app).get(rangeUrl).set(auth(pair.a.users.salesRep.token));
    expect(own.status).toBe(200);
    expect(own.body.value).toBe(12);
    const peek = await request(app).get(`${rangeUrl}&repId=${otherRepId}`).set(auth(pair.a.users.salesRep.token));
    expect(peek.body.value).toBe(12);
    expect(peek.body.detail.placed).toBe(3);
  });

  it('tenant B sees none of tenant A', async () => {
    const res = await request(app).get(rangeUrl).set(auth(pair.b.users.admin.token));
    expect(res.status).toBe(200);
    expect(res.body.value).toBeNull();
    expect(res.body.detail.placed).toBe(0);
    expect(res.body.operatingHoursSet).toBe(false);
  });
});
