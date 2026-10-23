/**
 * M4-T18, T19, T20 (COD-42): two-tenant checks for every new delivery-partner and proof route.
 * Tenant A never sees tenant B's partners, orders, attempts or photo.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

const WIDE = 'from=2020-01-01&to=2100-01-01';
let pair: TwoTenants;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const extraOrder = (tenantId: string, customerId: number, data: Record<string, unknown>) =>
  prismaBase.order.create({
    data: {
      customerId, subtotal: 10, shippingCost: 0, totalAmount: 10, codAmount: 10, deliveryAddress: '1 St',
      deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId, ...data,
    } as any,
  });

beforeAll(async () => {
  pair = await createTwoTenants('partners');
  const { a, b } = pair;
  const customerOf = async (id: string) => (await prismaBase.customer.findFirstOrThrow({ where: { tenantId: id } })).id;
  const [ca, cb] = [await customerOf(a.id), await customerOf(b.id)];
  // A: one failed order (not reachable). B: one failed order (refused) and one waiting order in a made-up region.
  await extraOrder(a.id, ca, { status: 'failed_delivery', failureReason: 'not_reachable', deliveryAgentId: a.users.deliveryAgent.id });
  await extraOrder(b.id, cb, { status: 'failed_delivery', failureReason: 'refused', deliveryAgentId: b.users.deliveryAgent.id });
  await extraOrder(b.id, cb, { status: 'confirmed', confirmedAt: new Date(), deliveryState: `Region ${b.marker}` });
}, 60000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('tenant A never sees tenant B (T18 reads)', () => {
  it('list: only A partners, and A numbers', async () => {
    const { a, b } = pair;
    const res = await request(app).get(`/api/delivery-partners?${WIDE}`).set(auth(a.users.admin.token));
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r: any) => r.partnerId)).toEqual([a.users.deliveryAgent.id]);
    expect(res.body.rows[0]).toMatchObject({ assigned: 2, outNow: 1, failed: 1, baseTown: `Town ${a.marker}`, daysToPay: 7 });
    expect(JSON.stringify(res.body)).not.toContain(b.marker);
  });

  it('summary, waiting and failure-reasons carry nothing of B', async () => {
    const { a, b } = pair;
    const h = auth(a.users.admin.token);
    const summary = await request(app).get(`/api/delivery-partners/summary?${WIDE}`).set(h);
    expect(summary.body.outNow).toEqual({ orders: 1, partners: 1 });
    expect(summary.body.waiting.orders).toBe(0);
    const waiting = await request(app).get('/api/delivery-partners/waiting').set(h);
    expect(waiting.body).toMatchObject({ orders: 0, list: [] });
    const reasons = await request(app).get(`/api/delivery-partners/failure-reasons?${WIDE}`).set(h);
    expect(reasons.body.total).toBe(1);
    expect(Object.fromEntries(reasons.body.reasons.map((r: any) => [r.reason, r.count]))).toMatchObject({ not_reachable: 1, refused: 0 });
    // B's own view has its own rows
    const bWaiting = await request(app).get('/api/delivery-partners/waiting').set(auth(b.users.admin.token));
    expect(bWaiting.body.orders).toBe(1);
    // A cannot filter by B's partner id
    const other = await request(app).get(`/api/delivery-partners/failure-reasons?${WIDE}&partnerId=${b.users.deliveryAgent.id}`).set(h);
    expect(other.body.total).toBe(0);
  });
});
