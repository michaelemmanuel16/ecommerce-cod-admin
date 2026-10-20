/**
 * M1-T15: GET /api/kpi/* needs a login and the analytics:view permission (same as /api/analytics; every default role has it),
 * and answers in the caller's tenant. A sales rep sees only orders assigned to them and a delivery agent only their own
 * deliveries, the same role scope as /api/analytics.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const RANGE = 'from=2026-10-01&to=2026-10-17';

beforeAll(async () => {
  pair = await createTwoTenants('kpiroutes');
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('/api/kpi', () => {
  it('401 with no token', async () => {
    expect((await request(app).get(`/api/kpi/revenue?${RANGE}`)).status).toBe(401);
    expect((await request(app).get(`/api/kpi/rates?${RANGE}`)).status).toBe(401);
  });

  it('revenue: an admin gets money as strings with 2 decimals', async () => {
    const res = await request(app).get(`/api/kpi/revenue?${RANGE}`).set(auth(pair.a.users.admin.token));
    expect(res.status).toBe(200);
    expect(res.body.total).toMatchObject({ unit: 'money', dateBasis: 'deliveryDate', formulaId: 'revenue.delivered.v1' });
    expect(res.body.total.value).toMatch(/^-?\d+\.\d{2}$/);
    // date-only `to` is inclusive: 17 Oct 2026 in Accra ends at 18 Oct 00:00 UTC
    expect(res.body.total.to).toBe('2026-10-18T00:00:00.000Z');
    expect(JSON.stringify(res.body)).not.toContain(pair.b.marker);
  });

  it('rates: an admin gets the three named rates and no banned key', async () => {
    const res = await request(app).get(`/api/kpi/rates?${RANGE}&basis=delivery`).set(auth(pair.a.users.admin.token));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['confirmationRate', 'deliverySuccessRate', 'orderToCashYield']);
    expect(res.body.deliverySuccessRate.dateBasis).toBe('delivery');
    expect(JSON.stringify(res.body)).not.toMatch(/deliveryRate|fulfilmentRate|fulfillmentRate|conversionRate/);
  });

  it('400 for a missing or bad range, basis or id', async () => {
    const h = auth(pair.a.users.admin.token);
    expect((await request(app).get('/api/kpi/revenue').set(h)).status).toBe(400);
    expect((await request(app).get('/api/kpi/revenue?from=2026-10-17&to=2026-10-01').set(h)).status).toBe(400);
    expect((await request(app).get('/api/kpi/revenue?from=nope&to=2026-10-01').set(h)).status).toBe(400);
    expect((await request(app).get(`/api/kpi/rates?${RANGE}&basis=weekly`).set(h)).status).toBe(400);
    expect((await request(app).get(`/api/kpi/rates?${RANGE}&partnerId=abc`).set(h)).status).toBe(400);
  });
});

describe('/api/kpi role scope', () => {
  // Two delivered October orders in tenant A: the rep's own (100) and one assigned to the admin with no partner (1000).
  beforeAll(async () => {
    const a = pair.a;
    const own = await prismaBase.order.findUniqueOrThrow({ where: { id: a.ids.order } });
    const at = new Date('2026-10-05T10:00:00Z');
    const base = {
      customerId: own.customerId, status: 'delivered' as const, deliveryDate: at, createdAt: at,
      shippingCost: 0, deliveryAddress: 'x', deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId: a.id,
    };
    await prismaBase.order.createMany({
      data: [
        { ...base, customerRepId: a.users.salesRep.id, deliveryAgentId: a.users.deliveryAgent.id, subtotal: 100, totalAmount: 100, codAmount: 100 },
        { ...base, customerRepId: a.users.admin.id, deliveryAgentId: null, subtotal: 1000, totalAmount: 1000, codAmount: 1000 },
      ],
    });
  });

  const revenueFor = async (token: string, extra = '') =>
    (await request(app).get(`/api/kpi/revenue?${RANGE}${extra}`).set(auth(token))).body.total.value;

  it('revenue: the admin sees both orders, a rep and an agent only their own', async () => {
    expect(await revenueFor(pair.a.users.admin.token)).toBe('1100.00');
    expect(await revenueFor(pair.a.users.salesRep.token)).toBe('100.00');
    expect(await revenueFor(pair.a.users.deliveryAgent.token)).toBe('100.00');
  });

  it('rates: a rep cannot read another rep with repId, an agent cannot read another partner with partnerId', async () => {
    const placed = async (token: string, extra: string) =>
      (await request(app).get(`/api/kpi/rates?${RANGE}${extra}`).set(auth(token))).body.confirmationRate.detail.placed;
    expect(await placed(pair.a.users.admin.token, `&repId=${pair.a.users.admin.id}`)).toBe(1);
    expect(await placed(pair.a.users.salesRep.token, `&repId=${pair.a.users.admin.id}`)).toBe(1);
    expect(await placed(pair.a.users.salesRep.token, '')).toBe(1);
    expect(await placed(pair.a.users.deliveryAgent.token, '&partnerId=999999')).toBe(1);
  });
});
