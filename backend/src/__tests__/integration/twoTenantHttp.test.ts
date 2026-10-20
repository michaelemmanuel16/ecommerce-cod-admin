/**
 * M0-T29 (COD-7), HTTP part: tenant A can never reach tenant B's deliveries, and
 * /api/admin/config answers each slug with its own business name.
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

beforeAll(async () => {
  pair = await createTwoTenants('http');
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('delivery routes', () => {
  it('lists only the caller tenant deliveries, for an admin and for an agent', async () => {
    const { a, b } = pair;
    for (const user of [a.users.admin, a.users.deliveryAgent]) {
      const res = await request(app).get('/api/deliveries').set(auth(user.token));
      expect(res.status).toBe(200);
      const ids = res.body.deliveries.map((d: any) => d.id);
      expect(ids).toContain(a.ids.delivery);
      expect(ids).not.toContain(b.ids.delivery);
      expect(JSON.stringify(res.body)).not.toContain(b.marker);
    }
  });

  it('B delivery is 404 for read, proof and complete, for an admin and for an agent', async () => {
    const { a, b } = pair;
    for (const user of [a.users.admin, a.users.deliveryAgent]) {
      const h = auth(user.token);
      const id = b.ids.delivery;
      expect((await request(app).get(`/api/deliveries/${id}`).set(h)).status).toBe(404);
      expect((await request(app).patch(`/api/deliveries/${id}/proof`).set(h).send({ proofType: 'signature', recipientName: 'X' })).status).toBe(404);
      expect((await request(app).patch(`/api/deliveries/${id}/complete`).set(h).send({ proofType: 'signature', recipientName: 'X' })).status).toBe(404);
    }
    // B's delivery is untouched
    const row = await prismaBase.delivery.findUniqueOrThrow({ where: { id: b.ids.delivery } });
    expect(row.actualDeliveryTime).toBeNull();
    expect(row.recipientName).toBeNull();
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: b.ids.order } });
    expect(order.status).toBe('out_for_delivery');
  });

  it('by-order and route lookups for B ids return nothing of B', async () => {
    const { a, b } = pair;
    const h = auth(a.users.admin.token);
    const byOrder = await request(app).get(`/api/deliveries/by-order/${b.ids.order}`).set(h);
    expect(byOrder.status).toBe(404);
    const route = await request(app).get(`/api/deliveries/routes/${b.users.deliveryAgent.id}`).set(h);
    expect(JSON.stringify(route.body)).not.toContain(b.marker);
    const own = await request(app).get(`/api/deliveries/by-order/${a.ids.order}`).set(h);
    expect(own.status).toBe(200);
  });

  it('agent-orders for tenant A agent never lists B orders', async () => {
    const { a, b } = pair;
    const res = await request(app).get('/api/deliveries/agent-orders').set(auth(a.users.deliveryAgent.token));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(b.marker);
  });
});

describe('/api/admin/config', () => {
  it('each tenant slug gets its own business name and currency', async () => {
    const { a, b } = pair;
    const ra = await request(app).get('/api/admin/config').query({ tenant: a.slug });
    const rb = await request(app).get('/api/admin/config').query({ tenant: b.slug });
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    expect(ra.body).toEqual({ businessName: `Biz A ${a.marker}`, currency: 'GHS' });
    expect(rb.body).toEqual({ businessName: `Biz B ${b.marker}`, currency: 'NGN' });
  });

  it('each form slug resolves to the tenant of that form', async () => {
    const { a, b } = pair;
    const ra = await request(app).get('/api/admin/config').query({ form: a.formSlug });
    const rb = await request(app).get('/api/admin/config').query({ form: b.formSlug });
    expect(ra.body.businessName).toBe(`Biz A ${a.marker}`);
    expect(rb.body.businessName).toBe(`Biz B ${b.marker}`);
  });

  it('the authenticated route answers with the caller tenant, never the other', async () => {
    const { a, b } = pair;
    const ra = await request(app).get('/api/admin/config/me').set(auth(a.users.admin.token));
    const rb = await request(app).get('/api/admin/config/me').set(auth(b.users.admin.token));
    expect(ra.body.businessName).toBe(`Biz A ${a.marker}`);
    expect(rb.body.businessName).toBe(`Biz B ${b.marker}`);
    expect(JSON.stringify(ra.body)).not.toContain(b.marker);
  });

  it('no slug and an unknown slug are 404', async () => {
    expect((await request(app).get('/api/admin/config')).status).toBe(404);
    expect((await request(app).get('/api/admin/config').query({ tenant: 'no-such-tenant-slug' })).status).toBe(404);
  });
});
