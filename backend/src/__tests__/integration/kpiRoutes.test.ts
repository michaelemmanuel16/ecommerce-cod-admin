/** M1-T15: GET /api/kpi/* needs a login and the analytics:view permission (same as /api/analytics; every default role has it), and answers in the caller's tenant. */
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
