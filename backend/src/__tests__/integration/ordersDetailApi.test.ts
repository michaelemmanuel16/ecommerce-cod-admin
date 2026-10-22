/**
 * M3-T16 (COD-23): GET /api/orders/:id and /:id/timeline, #<id> search, Kanban removal (F-300, F-321, F-322, F-323, F-327).
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { bearer } from './helpers/superAdminToken';

jest.setTimeout(180_000);

const SUFFIX = Date.now();
let tenantId: string;
let otherTenantId: string;
let customerId: number;
let productId: number;
const U: Record<string, { id: number; token: string }> = {};

const mkUser = async (label: string, role: any, tid = tenantId) => {
  const u = await prismaBase.user.create({
    data: { email: `od-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'Detail', role, tenantId: tid },
  });
  U[label] = { id: u.id, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId: tid }) };
};
const mkOrder = async (status: string, extra: Record<string, unknown> = {}, tid = tenantId, cid = customerId) =>
  (await prismaBase.order.create({
    data: {
      customerId: cid, status, subtotal: 100, totalAmount: 100, codAmount: 100, tenantId: tid,
      deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
      orderItems: { create: [{ productId, quantity: 2, unitPrice: 50, totalPrice: 100 }] },
      orderHistory: { create: { tenantId: tid, status: status as any, notes: 'Order created', changedBy: U.owner.id } },
      ...extra,
    } as any,
  })).id;
const detail = (who: string, id: number) => request(app).get(`/api/orders/${id}`).set(bearer(U[who].token));
const timeline = (who: string, id: number) => request(app).get(`/api/orders/${id}/timeline`).set(bearer(U[who].token));

beforeAll(async () => {
  tenantId = (await createTenant('Orders Detail')).id;
  otherTenantId = (await createTenant('Orders Detail Other')).id;
  await seedTenantDefaults(tenantId);
  await seedTenantDefaults(otherTenantId);
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+23324${String(SUFFIX).slice(-7)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  productId = (await prismaBase.product.create({ data: { sku: `OD-${SUFFIX}`, name: 'Copybook', category: 'x', price: 50, stockQuantity: 20, tenantId } })).id;
  await mkUser('owner', 'super_admin');
  await mkUser('admin', 'admin');
  await mkUser('rep', 'sales_rep');
  await mkUser('rep2', 'sales_rep');
  await mkUser('agent', 'delivery_agent');
  await mkUser('otherOwner', 'super_admin', otherTenantId);
}, 60_000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('GET /api/orders/:id', () => {
  it('returns items, customer, assignees, history, calls, messages, flags, transitions, paymentTag and displayNumber', async () => {
    const id = await mkOrder('confirmed', { customerRepId: U.rep.id, deliveryAgentId: U.agent.id, source: 'import' });
    await prismaBase.call.create({ data: { orderId: id, customerId, salesRepId: U.rep.id, outcome: 'confirmed', tenantId } });
    const res = await detail('admin', id);
    expect(res.status).toBe(200);
    const o = res.body.order;
    expect(o.id).toBe(id);
    expect(o.displayNumber).toBe(`#${id}`);
    expect(o.items).toEqual([expect.objectContaining({ productId, quantity: 2, product: expect.objectContaining({ name: 'Copybook' }) })]);
    expect(o.orderItems).toHaveLength(1);
    expect(o.customer).toMatchObject({ id: customerId, firstName: 'Ama' });
    expect(o.assignees.customerRep).toMatchObject({ id: U.rep.id });
    expect(o.assignees.deliveryAgent).toMatchObject({ id: U.agent.id });
    expect(o.history).toEqual([expect.objectContaining({ status: 'confirmed', notes: 'Order created' })]);
    expect(o.calls).toEqual([expect.objectContaining({ outcome: 'confirmed', salesRep: expect.objectContaining({ id: U.rep.id }) })]);
    expect(o.messages).toEqual([]);
    expect(o.flags).toEqual([]);
    expect(o.transitions.status).toBe('confirmed');
    expect(o.transitions.normal).toEqual(expect.arrayContaining(['preparing', 'cancelled']));
    expect(o.paymentTag).toEqual({ code: 'pay_on_delivery', label: 'Pay on delivery' });
    expect(o.source).toBe('import');
  });

  it('shows the flags of the order', async () => {
    const id = await mkOrder('pending_confirmation');
    const res = await detail('admin', id);
    expect(res.body.order.flags).toEqual([{ code: 'no_call_rep', label: 'No call rep' }]);
  });

  it('payment block: deposit line, and "Cash held by" only with financial:view', async () => {
    const id = await mkOrder('delivered', {
      deliveryAgentId: U.agent.id, customerRepId: U.rep.id, paymentStatus: 'collected', deliveryDate: new Date(),
      paymentMethod: 'paystack_deposit', depositPaid: 30, balanceDue: 70,
    });
    await prismaBase.agentCollection.create({ data: { orderId: id, agentId: U.agent.id, amount: 70, collectionDate: new Date(), tenantId } });

    const admin = (await detail('admin', id)).body.order;
    expect(admin.paymentTag.code).toBe('cash_with_agent');
    expect(admin.payment).toMatchObject({ method: 'paystack_deposit', status: 'collected', amount: '100.00', deposit: { paid: '30.00', due: '70.00' }, cashHeldBy: 'agent Detail' });

    const rep = (await detail('rep', id)).body.order;
    expect(rep.payment).not.toHaveProperty('cashHeldBy');
    expect(rep.paymentTag.code).toBe('cash_with_agent');
  });

  it('"Cash held by" reads "Nobody yet" with no collection and "Paid in" when reconciled', async () => {
    const none = await mkOrder('confirmed');
    expect((await detail('admin', none)).body.order.payment.cashHeldBy).toBe('Nobody yet');
    const paid = await mkOrder('delivered', { paymentStatus: 'reconciled', deliveryDate: new Date() });
    const res = (await detail('admin', paid)).body.order;
    expect(res.payment.cashHeldBy).toBe('Paid in');
    expect(res.paymentTag.code).toBe('paid_in');
  });

  it('a rep sees own orders only; the other rep gets 404', async () => {
    const id = await mkOrder('confirmed', { customerRepId: U.rep.id });
    expect((await detail('rep', id)).status).toBe(200);
    expect((await detail('rep2', id)).status).toBe(404);
    expect((await detail('agent', id)).status).toBe(404);
  });

  it('a deleted order returns 404 "This order was deleted."; a missing one returns 404', async () => {
    const id = await mkOrder('cancelled', { deletedAt: new Date() });
    const res = await detail('admin', id);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).toContain('This order was deleted.');
    expect((await detail('admin', 987654321)).status).toBe(404);
  });

  it('a rep asking for another rep\'s deleted order gets the generic "Order not found"; the owning rep sees the deleted message', async () => {
    const id = await mkOrder('cancelled', { customerRepId: U.rep.id, deletedAt: new Date() });
    for (const who of ['rep2', 'agent']) {
      const res = await detail(who, id);
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).toContain('Order not found');
      expect(JSON.stringify(res.body)).not.toContain('deleted');
      expect((await timeline(who, id)).body.message).toBe('Order not found');
    }
    expect(JSON.stringify((await detail('rep', id)).body)).toContain('This order was deleted.');
  });

  it('two tenants: an order of another tenant returns 404 on detail and timeline', async () => {
    const otherCustomer = (await prismaBase.customer.create({
      data: { firstName: 'Kofi', lastName: 'Other', phoneNumber: `+23327${String(SUFFIX).slice(-7)}`, address: '5 Rd', state: 'Ashanti', area: 'Adum', tenantId: otherTenantId },
    })).id;
    const foreign = await mkOrder('confirmed', {
      orderItems: undefined, orderHistory: { create: { tenantId: otherTenantId, status: 'confirmed' } },
    }, otherTenantId, otherCustomer);
    const crossTenant = await detail('owner', foreign);
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.body.message).toBe('Order not found');
    expect((await timeline('owner', foreign)).status).toBe(404);
    expect((await request(app).get(`/api/orders/${foreign}`).set(bearer(U.otherOwner.token))).status).toBe(200);
  });
});

describe('GET /api/orders/:id/timeline', () => {
  it('shows a forced move with its reason and the Override flag', async () => {
    const id = await mkOrder('confirmed', { confirmedAt: new Date() });
    const moved = await request(app).patch(`/api/orders/${id}/status`).set(bearer(U.owner.token))
      .send({ status: 'pending_confirmation', force: true, reason: 'Customer asked to hold the order' });
    expect(moved.status).toBe(200);

    const res = await timeline('owner', id);
    expect(res.status).toBe(200);
    const forced = res.body.timeline.find((r: any) => r.kind === 'status' && r.status === 'pending_confirmation');
    expect(forced).toMatchObject({
      override: true, reason: 'Customer asked to hold the order', fromStatus: 'confirmed',
      actor: { kind: 'person', userId: U.owner.id, name: 'owner Detail' },
    });
    expect(res.body.timeline[0]).toMatchObject({ kind: 'placed' });
  });

  it('includes an edit, a call and a planned re-delivery', async () => {
    const id = await mkOrder('failed_delivery', { nextAttemptDate: new Date(Date.now() + 2 * 86_400_000), customerRepId: U.rep.id });
    await prismaBase.call.create({ data: { orderId: id, customerId, salesRepId: U.rep.id, outcome: 'not_reachable', tenantId } });
    const edit = await request(app).put(`/api/orders/${id}`).set(bearer(U.owner.token)).send({ notes: 'Gate code 4411' });
    expect(edit.status).toBe(200);

    const rows = (await timeline('owner', id)).body.timeline;
    expect(rows.some((r: any) => r.kind === 'call' && r.title === 'Call: not reachable')).toBe(true);
    expect(rows.some((r: any) => r.kind === 'edit' && r.size === 'small')).toBe(true);
    expect(rows[rows.length - 1]).toMatchObject({ kind: 'planned', title: 'Re-delivery planned' });
  });

  it('a rep sees the timeline of own orders only', async () => {
    const id = await mkOrder('confirmed', { customerRepId: U.rep.id });
    expect((await timeline('rep', id)).status).toBe(200);
    expect((await timeline('rep2', id)).status).toBe(404);
  });
});

describe('Search and Kanban (F-300, F-327)', () => {
  it('finds the same order by 24118-style numbers with and without the #', async () => {
    const id = await mkOrder('confirmed');
    const plain = await request(app).get('/api/orders').query({ search: String(id) }).set(bearer(U.owner.token));
    const hash = await request(app).get('/api/orders').query({ search: `#${id}` }).set(bearer(U.owner.token));
    expect(plain.body.orders.map((o: any) => o.id)).toContain(id);
    expect(hash.body.orders.map((o: any) => o.id)).toEqual(plain.body.orders.map((o: any) => o.id));
  });

  it('GET /api/orders/kanban returns 404', async () => {
    const res = await request(app).get('/api/orders/kanban').set(bearer(U.owner.token));
    expect(res.status).toBe(404);
  });
});
