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
import { bearer } from './helpers/superAdminToken';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { signedProofPhotoUrl } from '../../services/deliveryProofService';

const WIDE = 'from=2020-01-01&to=2100-01-01';
let pair: TwoTenants;

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
    const res = await request(app).get(`/api/delivery-partners?${WIDE}`).set(bearer(a.users.admin.token));
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r: any) => r.partnerId)).toEqual([a.users.deliveryAgent.id]);
    expect(res.body.rows[0]).toMatchObject({ assigned: 2, outNow: 1, failed: 1, baseTown: `Town ${a.marker}`, daysToPay: 7 });
    expect(JSON.stringify(res.body)).not.toContain(b.marker);
  });

  it('summary, waiting and failure-reasons carry nothing of B', async () => {
    const { a, b } = pair;
    const h = bearer(a.users.admin.token);
    const summary = await request(app).get(`/api/delivery-partners/summary?${WIDE}`).set(h);
    expect(summary.body.outNow).toEqual({ orders: 1, partners: 1 });
    expect(summary.body.waiting.orders).toBe(0);
    const waiting = await request(app).get('/api/delivery-partners/waiting').set(h);
    expect(waiting.body).toMatchObject({ orders: 0, list: [] });
    const reasons = await request(app).get(`/api/delivery-partners/failure-reasons?${WIDE}`).set(h);
    expect(reasons.body.total).toBe(1);
    expect(Object.fromEntries(reasons.body.reasons.map((r: any) => [r.reason, r.count]))).toMatchObject({ not_reachable: 1, refused: 0 });
    // B's own view has its own rows
    const bWaiting = await request(app).get('/api/delivery-partners/waiting').set(bearer(b.users.admin.token));
    expect(bWaiting.body.orders).toBe(1);
    // A cannot filter by B's partner id
    const other = await request(app).get(`/api/delivery-partners/failure-reasons?${WIDE}&partnerId=${b.users.deliveryAgent.id}`).set(h);
    expect(other.body.total).toBe(0);
  });
});

describe('tenant A never reaches tenant B (T19 writes)', () => {
  it('a partner created in A is not in B, and B ids are 404 for every A write', async () => {
    const { a, b } = pair;
    const ha = bearer(a.users.admin.token);
    const created = await request(app).post('/api/delivery-partners').set(ha).send({
      kind: 'person', firstName: 'Tenant', lastName: `A${a.marker}`, email: `partner-${a.marker}@codadmin.test`,
    });
    expect(created.status).toBe(201);
    const bList = await request(app).get(`/api/delivery-partners?${WIDE}`).set(bearer(b.users.admin.token));
    expect(JSON.stringify(bList.body)).not.toContain(`A${a.marker}`);
    expect((await request(app).get(`/api/delivery-partners/${created.body.partner.id}`).set(bearer(b.users.admin.token))).status).toBe(404);

    const bId = b.users.deliveryAgent.id;
    expect((await request(app).get(`/api/delivery-partners/${bId}`).set(ha)).status).toBe(404);
    expect((await request(app).patch(`/api/delivery-partners/${bId}`).set(ha).send({ daysToPay: 1 })).status).toBe(404);
    expect((await request(app).patch(`/api/delivery-partners/${bId}/availability`).set(ha).send({ isAvailable: false })).status).toBe(404);
    const row = await prismaBase.user.findUniqueOrThrow({ where: { id: bId } });
    const profile = await prismaBase.deliveryPartnerProfile.findUniqueOrThrow({ where: { userId: bId } });
    expect([row.isAvailable, profile.daysToPay]).toEqual([true, 7]);
  });

  it('the region review lists the caller tenant only', async () => {
    const { a, b } = pair;
    const review = await request(app).get('/api/delivery-partners/region-review').set(bearer(a.users.admin.token));
    expect(review.status).toBe(200);
    expect(JSON.stringify(review.body)).not.toContain(b.marker);
    const bReview = await request(app).get('/api/delivery-partners/region-review').set(bearer(b.users.admin.token));
    expect(bReview.body.regions.map((r: any) => r.value)).toContain(`Region ${b.marker}`);
  });
});

describe('tenant A never reaches tenant B (T20 proof and attempts)', () => {
  it('by-order shows A attempts only; a B order is 404; a photo link of B does not open under A', async () => {
    const { a, b } = pair;
    const own = await request(app).get(`/api/deliveries/by-order/${a.ids.order}`).set(bearer(a.users.admin.token));
    expect(own.status).toBe(200);
    expect(own.body.attempts.map((x: any) => x.note)).toContain(`attempt ${a.marker}`);
    expect(JSON.stringify(own.body)).not.toContain(b.marker);
    expect((await request(app).get(`/api/deliveries/by-order/${b.ids.order}`).set(bearer(a.users.admin.token))).status).toBe(404);

    await prismaBase.delivery.update({ where: { id: b.ids.delivery }, data: { proofImageUrl: '/uploads/none.png' } });
    const link = signedProofPhotoUrl({ id: b.ids.delivery, tenantId: b.id });
    expect((await request(app).get(link.replace(`t=${b.id}`, `t=${a.id}`))).status).toBe(403);
  });

  it('order-proofs gives A orders only; a B order id or a B partner id returns nothing', async () => {
    const { a, b } = pair;
    const ha = bearer(a.users.admin.token);
    const own = await request(app).get(`/api/delivery-partners/${a.users.deliveryAgent.id}/order-proofs?orderIds=${a.ids.order},${b.ids.order}`).set(ha);
    expect(own.status).toBe(200);
    expect(own.body.proofs.map((p: any) => p.orderId)).toEqual([a.ids.order]);
    expect(JSON.stringify(own.body)).not.toContain(b.id);
    const other = await request(app).get(`/api/delivery-partners/${b.users.deliveryAgent.id}/order-proofs?orderIds=${b.ids.order}`).set(ha);
    expect(other.body.proofs).toEqual([]);
  });
});
