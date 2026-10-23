/**
 * M1-T11 / M1-T12: the order status API over HTTP (PATCH /api/orders/:id/status, GET /:id/transitions,
 * PUT /api/orders/:id with a status) and completeDelivery through the state machine.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { generateAccessToken } from '../../utils/jwt';
import { runInTenant } from '../../utils/tenantContext';
import { transitionOrder } from '../../services/orderStateMachine';
import orderService from '../../services/orderService';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const SUFFIX = Date.now();
let tenantId: string;
let customerId: number;
let productId: number;
const U: Record<string, any> = {};

const mkUser = (label: string, role: any) =>
  prismaBase.user.create({
    data: { email: `osa-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'T', role, tenantId },
  });
const auth = (u: any) => ({
  Authorization: `Bearer ${generateAccessToken({ id: u.id, email: u.email, role: u.role, tenantId: u.tenantId })}`,
});
const mkOrder = async (status: any, extra: Record<string, unknown> = {}) =>
  (await prismaBase.order.create({
    data: {
      customerId, status, subtotal: 10, totalAmount: 10, codAmount: 10, tenantId,
      deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
      ...extra,
    } as any,
  })).id;
const patch = (u: any, id: number, body: Record<string, unknown>) =>
  request(app).patch(`/api/orders/${id}/status`).set(auth(u)).send(body);
const stock = async () => (await prismaBase.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity;

beforeAll(async () => {
  tenantId = (await createTenant('OSA Tenant')).id;
  await seedTenantDefaults(tenantId);
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-8)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  productId = (await prismaBase.product.create({
    data: { sku: `OSA-${SUFFIX}`, name: 'OSA Product', category: 'test', price: 10, cogs: 4, stockQuantity: 50, tenantId },
  })).id;
  U.admin = await mkUser('admin', 'admin');
  U.superAdmin = await mkUser('super', 'super_admin');
  U.rep = await mkUser('rep', 'sales_rep');
  U.agent = await mkUser('agent', 'delivery_agent');
  U.inventory = await mkUser('inventory', 'inventory_manager');
}, 30000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('PATCH /api/orders/:id/status accepts all 12 statuses', () => {
  // [target, source, extra order fields, body extras, acting user]
  const cases: Array<[string, string, Record<string, unknown>, Record<string, unknown>, string]> = [
    ['pending_confirmation', 'confirmed', {}, { force: true, reason: 'Customer asked to hold the order' }, 'superAdmin'],
    ['payment_pending', 'pending_confirmation', {}, {}, 'admin'],
    ['payment_failed', 'payment_pending', {}, {}, 'admin'],
    ['confirmed', 'pending_confirmation', {}, {}, 'admin'],
    ['preparing', 'confirmed', {}, {}, 'admin'],
    ['ready_for_pickup', 'confirmed', {}, {}, 'admin'],
    ['out_for_delivery', 'confirmed', { deliveryAgentId: 'AGENT' }, {}, 'admin'],
    ['delivered', 'out_for_delivery', { deliveryAgentId: 'AGENT' }, {}, 'admin'],
    ['digital_delivered', 'payment_pending', { orderType: 'digital' }, {}, 'admin'],
    ['failed_delivery', 'out_for_delivery', { deliveryAgentId: 'AGENT' }, { failureReason: 'not_reachable' }, 'admin'],
    ['returned', 'delivered', { deliveryAgentId: 'AGENT' }, {}, 'admin'],
    ['cancelled', 'confirmed', {}, {}, 'admin'],
  ];

  it.each(cases)('-> %s (from %s)', async (target, source, extra, body, who) => {
    const fields = { ...extra, ...(extra.deliveryAgentId ? { deliveryAgentId: U.agent.id } : {}) };
    const id = await mkOrder(source, fields);
    const res = await patch(U[who], id, { status: target, ...body });
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe(target);
    const rows = await prismaBase.orderHistory.findMany({ where: { orderId: id, status: target as any } });
    expect(rows).toHaveLength(1);
    expect(rows[0].fromStatus).toBe(source);
  });

  it('rejects a status that is not one of the 12', async () => {
    const id = await mkOrder('confirmed');
    expect((await patch(U.admin, id, { status: 'dispatched' })).status).toBe(400);
  });
});

describe('reason rules', () => {
  it('a move to failed_delivery without failureReason works (COD-139)', async () => {
    const id = await mkOrder('out_for_delivery', { deliveryAgentId: U.agent.id });
    const res = await patch(U.admin, id, { status: 'failed_delivery' });
    expect(res.status).toBe(200);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).status).toBe('failed_delivery');
  });

  it('a sales rep cancelling from pending_confirmation may leave declineReason out (COD-139); an admin too', async () => {
    const bare = await mkOrder('pending_confirmation', { customerRepId: U.rep.id });
    expect((await patch(U.rep, bare, { status: 'cancelled' })).status).toBe(200);

    const id = await mkOrder('pending_confirmation', { customerRepId: U.rep.id });
    const ok = await patch(U.rep, id, { status: 'cancelled', declineReason: 'price_too_high' });
    expect(ok.status).toBe(200);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).declineReason).toBe('price_too_high');

    const adminId = await mkOrder('pending_confirmation');
    expect((await patch(U.admin, adminId, { status: 'cancelled' })).status).toBe(200);
  });

  it('moving back to out_for_delivery clears failureReason', async () => {
    const id = await mkOrder('out_for_delivery', { deliveryAgentId: U.agent.id });
    expect((await patch(U.admin, id, { status: 'failed_delivery', failureReason: 'refused' })).status).toBe(200);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).failureReason).toBe('refused');
    expect((await patch(U.admin, id, { status: 'out_for_delivery' })).status).toBe(200);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).failureReason).toBeNull();
  });
});

describe('error body and transitions', () => {
  it('an invalid move is 409 with code, from, to and allowed', async () => {
    const id = await mkOrder('confirmed');
    const res = await patch(U.admin, id, { status: 'delivered' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'INVALID_TRANSITION', from: 'confirmed', to: 'delivered' });
    expect(typeof res.body.error).toBe('string');
    expect(res.body.allowed).toEqual(['preparing', 'ready_for_pickup', 'out_for_delivery', 'cancelled']);
  });

  it('GET transitions for a delivered order as admin returns only returned, and no forced moves', async () => {
    const id = await mkOrder('delivered', { deliveryAgentId: U.agent.id });
    const res = await request(app).get(`/api/orders/${id}/transitions`).set(auth(U.admin));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'delivered', normal: ['returned'], forced: [] });
  });

  it('GET transitions lists forced moves only for a user with orders:force_status', async () => {
    const id = await mkOrder('delivered', { deliveryAgentId: U.agent.id });
    const res = await request(app).get(`/api/orders/${id}/transitions`).set(auth(U.superAdmin));
    expect(res.body.normal).toEqual(['returned']);
    expect(res.body.forced.length).toBe(7);
    expect(res.body.forced).not.toContain('delivered');
    expect(res.body.forced).not.toContain('returned');
  });

  it('GET transitions hides another rep\'s order from a sales rep (404) and shows the rep their own', async () => {
    const other = await mkOrder('pending_confirmation');
    expect((await request(app).get(`/api/orders/${other}/transitions`).set(auth(U.rep))).status).toBe(404);
    const own = await mkOrder('pending_confirmation', { customerRepId: U.rep.id });
    const res = await request(app).get(`/api/orders/${own}/transitions`).set(auth(U.rep));
    expect(res.status).toBe(200);
    expect(res.body.normal).toEqual(expect.arrayContaining(['confirmed', 'cancelled']));
  });

  it('GET transitions of a missing order is 404', async () => {
    expect((await request(app).get('/api/orders/99999999/transitions').set(auth(U.admin))).status).toBe(404);
  });
});

describe('inventory_manager has orders:update_status, not orders:update', () => {
  it('may PATCH a pre-dispatch status move but gets 403 on PUT /orders/:id', async () => {
    const id = await mkOrder('confirmed');
    const moved = await patch(U.inventory, id, { status: 'preparing' });
    expect(moved.status).toBe(200);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).status).toBe('preparing');

    const edited = await request(app).put(`/api/orders/${id}`).set(auth(U.inventory)).send({ deliveryAddress: 'Somewhere else' });
    expect(edited.status).toBe(403);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).deliveryAddress).toBe('1 St');
  });
});

describe('PUT /api/orders/:id with a status goes through the state machine', () => {
  it('a valid move writes a history row and the status', async () => {
    const id = await mkOrder('pending_confirmation');
    const res = await request(app).put(`/api/orders/${id}`).set(auth(U.admin)).send({ status: 'confirmed', notes: 'edited' });
    expect(res.status).toBe(200);
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id } });
    expect(order.status).toBe('confirmed');
    expect(order.notes).toBe('edited');
    expect(order.confirmedAt).toBeInstanceOf(Date);
    const rows = await prismaBase.orderHistory.findMany({ where: { orderId: id, status: 'confirmed' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromStatus: 'pending_confirmation', actorKind: 'user', changedBy: U.admin.id });
  });

  it('an invalid move is 409 and nothing else in the body is saved', async () => {
    const id = await mkOrder('confirmed');
    const res = await request(app).put(`/api/orders/${id}`).set(auth(U.admin)).send({ status: 'delivered', notes: 'should not save' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id } });
    expect(order.status).toBe('confirmed');
    expect(order.notes).not.toBe('should not save');
  });
});

describe('completeDelivery through the machine', () => {
  it('a second complete call changes nothing: no extra history, GL entry or stock movement', async () => {
    const id = await mkOrder('out_for_delivery', {
      deliveryAgentId: U.agent.id,
      orderItems: { create: [{ productId, quantity: 2, unitPrice: 5, totalPrice: 10 }] },
    });
    const delivery = await prismaBase.delivery.create({
      data: { orderId: id, agentId: U.agent.id, scheduledTime: new Date(), tenantId },
    });
    const body = { proofType: 'signature', proofData: 'sig', recipientName: 'Recipient', codAmount: 10 };
    const stockBefore = await stock();

    const first = await request(app).patch(`/api/deliveries/${delivery.id}/complete`).set(auth(U.agent)).send(body);
    expect(first.status).toBe(200);
    expect(first.body.glEntry).not.toBeNull();

    const order = await prismaBase.order.findUniqueOrThrow({ where: { id } });
    expect(order).toMatchObject({ status: 'delivered', paymentStatus: 'collected', revenueRecognized: true });
    expect(order.glJournalEntryId).not.toBeNull();
    expect(await stock()).toBe(stockBefore); // D8: completeDelivery does no stock work

    const counts = async () => ({
      history: await prismaBase.orderHistory.count({ where: { orderId: id } }),
      gl: await prismaBase.journalEntry.count({ where: { sourceType: 'order_delivery', sourceId: id } }),
      transactions: await prismaBase.transaction.count({ where: { orderId: id } }),
      stock: await stock(),
    });
    const after = await counts();
    expect(after.history).toBe(1);
    expect(after.gl).toBe(1);

    const second = await request(app).patch(`/api/deliveries/${delivery.id}/complete`).set(auth(U.agent)).send(body);
    expect(second.status).toBe(400);
    expect(await counts()).toEqual(after);
  });
});

describe('other writers', () => {
  it('Paystack digital settlement: system actor moves a confirmed digital order, dated the settle time', async () => {
    const id = await mkOrder('confirmed', { orderType: 'digital' });
    const settled = new Date('2026-10-17T09:30:00.000Z');
    await runInTenant(tenantId, () =>
      transitionOrder(id, 'digital_delivered', { kind: 'system' }, { note: 'Download link sent to customer', deliveryDate: settled }),
    );
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id } });
    expect(order.status).toBe('digital_delivered');
    expect(order.deliveryDate?.toISOString()).toBe(settled.toISOString());
    const rows = await prismaBase.orderHistory.findMany({ where: { orderId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorKind: 'system', status: 'digital_delivered' });
  });

  it('cancelOrder writes one history row through the machine', async () => {
    const id = await mkOrder('confirmed');
    await runInTenant(tenantId, () => orderService.cancelOrder(id, U.admin.id, 'Customer request', { id: U.admin.id, role: 'admin' }));
    const rows = await prismaBase.orderHistory.findMany({ where: { orderId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'cancelled', fromStatus: 'confirmed', actorKind: 'user', notes: 'Customer request' });
  });
});
