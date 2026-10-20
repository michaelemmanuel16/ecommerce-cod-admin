/**
 * M1-T19: GET /api/kpi/leadership needs a login and analytics:view, answers in the caller's tenant, validates asOf,
 * and applies the role scope: a sales rep sees only orders assigned to them, a delivery agent only their own
 * deliveries (D19).
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
const AS_OF = 'asOf=2026-10-17';

beforeAll(async () => {
  pair = await createTwoTenants('kpilead');
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
  await prismaBase.target.create({
    data: { tenantId: a.id, scope: 'month', metric: 'revenue', unit: 'money', periodStart: new Date('2026-10-01T00:00:00Z'), periodEnd: new Date('2026-10-31T00:00:00Z'), value: 5000 },
  });
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

const get = (token: string, query = AS_OF) => request(app).get(`/api/kpi/leadership?${query}`).set(auth(token));

describe('/api/kpi/leadership', () => {
  it('401 with no token', async () => {
    expect((await request(app).get(`/api/kpi/leadership?${AS_OF}`)).status).toBe(401);
  });

  it('an admin gets the leadership numbers for the tenant, money as strings with 2 decimals', async () => {
    const res = await get(pair.a.users.admin.token);
    expect(res.status).toBe(200);
    expect(res.body.asOfDate).toBe('2026-10-17');
    expect(res.body.revenueSoFar.value).toBe('1100.00'); // the other tenant's order (222.22) is not in it
    expect(res.body.projectedMonth.value).toMatch(/^\d+\.\d{2}$/);
    expect(res.body.attainment.month).toMatchObject({ target: '5000.00', actual: '1100.00', value: 22 });
    expect(res.body.pace.month.dateBasis).toBe('deliveryDate');
    expect(JSON.stringify(res.body)).not.toContain(pair.b.marker);
    expect(JSON.stringify(res.body)).not.toContain(pair.b.amount);
  });

  it('role scope: a rep and an agent see only their own orders; the other side is invisible to them', async () => {
    expect((await get(pair.a.users.salesRep.token)).body.revenueSoFar.value).toBe('100.00');
    expect((await get(pair.a.users.deliveryAgent.token)).body.revenueSoFar.value).toBe('100.00');
    // the admin owns the 1,000 order as a rep; the sales rep cannot reach it by any query value
    expect((await get(pair.a.users.salesRep.token, `${AS_OF}&repId=${pair.a.users.admin.id}`)).body.revenueSoFar.value).toBe('100.00');
  });

  it('asOf: defaults to today; 400 for a bad or impossible day', async () => {
    const h = pair.a.users.admin.token;
    expect((await get(h, '')).status).toBe(200);
    expect((await get(h, 'asOf=17-10-2026')).status).toBe(400);
    expect((await get(h, 'asOf=2026-02-30')).status).toBe(400);
  });
});
