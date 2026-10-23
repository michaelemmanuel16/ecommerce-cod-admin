/**
 * M3-T13 (COD-23): POST /api/orders and PUT /api/orders/:id (F-317, F-318).
 * Create: fixed start status, confirmed-on-the-call flag, rep self-assign, phone linking, stock.
 * Edit: editable fields per status group, audit before/after, STALE_ORDER, phone rules, rep ownership.
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
import { stockUp } from './helpers/stock';

jest.setTimeout(180_000);

const SUFFIX = Date.now();
let tenantId: string;
let otherTenantId: string;
let productA: number;
let productB: number;
let customerId: number;
let seq = 0;
const U: Record<string, { id: number; token: string }> = {};

// Distinct valid Ghana numbers per call, so no test meets another test's customer
const phone = () => `+23324${String(SUFFIX).slice(-4)}${String(1000 + seq++).slice(-3)}`.slice(0, 13);

const mkUser = async (label: string, role: any, tid = tenantId) => {
  const u = await prismaBase.user.create({
    data: { email: `oce-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'Edit', role, tenantId: tid },
  });
  U[label] = { id: u.id, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId: tid }) };
};
const mkCustomer = (first: string, ph = phone(), tid = tenantId) => prismaBase.customer.create({
  data: { firstName: first, lastName: 'Buyer', phoneNumber: ph, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId: tid },
});
const mkOrder = async (status: string, extra: Record<string, unknown> = {}) => {
  const o = await prismaBase.order.create({
    data: {
      customerId, status, subtotal: 100, totalAmount: 100, codAmount: 100, tenantId,
      deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
      orderItems: { create: [{ productId: productA, quantity: 2, unitPrice: 50, totalPrice: 100 }] },
      ...extra,
    } as any,
  });
  return o.id;
};
const body = (extra: Record<string, unknown> = {}) => ({
  customerName: 'Abena Owusu', customerPhone: phone(),
  orderItems: [{ productId: productA, quantity: 2, unitPrice: 50 }],
  discount: 10, totalAmount: 95, // lines 100, discount 10, typed total 95
  deliveryAddress: '12 Oak St', deliveryState: 'Ashanti', deliveryArea: 'Adum', ...extra,
});
const create = (who: string, extra: Record<string, unknown> = {}) =>
  request(app).post('/api/orders').set(bearer(U[who].token)).send(body(extra));
const edit = (who: string, id: number, data: Record<string, unknown>) =>
  request(app).put(`/api/orders/${id}`).set(bearer(U[who].token)).send(data);
const row = (id: number) => prismaBase.order.findUniqueOrThrow({ where: { id }, include: { orderItems: true, customer: true } });

beforeAll(async () => {
  tenantId = (await createTenant('Orders CreateEdit')).id;
  otherTenantId = (await createTenant('Orders CreateEdit Other')).id;
  await seedTenantDefaults(tenantId);
  await seedTenantDefaults(otherTenantId);
  productA = (await prismaBase.product.create({ data: { sku: `A-${SUFFIX}`, name: 'Copybook', category: 'x', price: 50, stockQuantity: 20, tenantId } })).id;
  productB = (await prismaBase.product.create({ data: { sku: `B-${SUFFIX}`, name: 'Pen set', category: 'x', price: 20, stockQuantity: 5, tenantId } })).id;
  // Available to sell comes from the levels (M4-T16)
  await stockUp(tenantId, productA, 20);
  await stockUp(tenantId, productB, 5);
  customerId = (await mkCustomer('Ama')).id;
  await mkUser('owner', 'super_admin');
  await mkUser('admin', 'admin');
  await mkUser('manager', 'manager');
  await mkUser('rep', 'sales_rep');
  await mkUser('rep2', 'sales_rep');
  await mkUser('agent', 'delivery_agent');
  await mkUser('otherAdmin', 'admin', otherTenantId);
}, 60_000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('POST /api/orders', () => {
  it('saves region, town, discount, total, call rep and agent; always starts pending_confirmation; a status in the body is ignored', async () => {
    const res = await create('admin', { status: 'delivered', customerRepId: U.rep.id, deliveryAgentId: U.agent.id, notes: 'Phone order' });
    expect(res.status).toBe(201);
    const o = await row(res.body.order.id);
    expect(o.status).toBe('pending_confirmation');
    expect(o.deliveryState).toBe('Ashanti');
    expect(o.deliveryArea).toBe('Adum');
    expect(o.discount.toString()).toBe('10');
    expect(o.subtotal.toString()).toBe('100'); // the lines, not the typed total
    expect(o.totalAmount.toString()).toBe('95');
    expect(o.customerRepId).toBe(U.rep.id);
    expect(o.deliveryAgentId).toBe(U.agent.id);
    expect(o.createdById).toBe(U.admin.id);
    expect(o.source).toBe('manual');
    expect(await prismaBase.call.count({ where: { orderId: o.id } })).toBe(0);
  });

  it('"customer already confirmed" moves the order through the machine and saves a manual confirmed Call', async () => {
    const res = await create('admin', { customerConfirmed: true });
    expect(res.status).toBe(201);
    expect(res.body.order.status).toBe('confirmed');
    const id = res.body.order.id;
    const o = await row(id);
    expect(o.status).toBe('confirmed');
    expect(o.confirmedAt).not.toBeNull();
    expect(o.confirmedById).toBe(U.admin.id);
    expect(o.firstContactAt).not.toBeNull();
    // the machine wrote the move: history row from pending_confirmation, by a user
    const moves = await prismaBase.orderHistory.findMany({ where: { orderId: id, status: 'confirmed' } });
    expect(moves).toEqual([expect.objectContaining({ fromStatus: 'pending_confirmation', actorKind: 'user', changedBy: U.admin.id })]);
    const calls = await prismaBase.call.findMany({ where: { orderId: id } });
    expect(calls).toEqual([expect.objectContaining({ outcome: 'confirmed', source: 'manual', salesRepId: U.admin.id, customerId: o.customerId })]);
  });

  it('a rep-created order has the rep as call rep and creator, and the rep sees it', async () => {
    const res = await create('rep', { customerRepId: U.rep2.id });
    expect(res.status).toBe(201);
    const id = res.body.order.id;
    const o = await row(id);
    expect(o.customerRepId).toBe(U.rep.id); // a body value cannot give it to someone else
    expect(o.createdById).toBe(U.rep.id);
    const list = await request(app).get('/api/orders').query({ limit: 100 }).set(bearer(U.rep.token));
    expect(list.body.orders.map((x: any) => x.id)).toContain(id);
    expect((await request(app).get(`/api/orders/${id}`).set(bearer(U.rep.token))).status).toBe(200);
    // the other rep does not see it
    const other = await request(app).get('/api/orders').query({ limit: 100 }).set(bearer(U.rep2.token));
    expect(other.body.orders.map((x: any) => x.id)).not.toContain(id);
  });

  it('a rep can tick confirmed on own order; a rep cannot pick a delivery agent', async () => {
    const ok = await create('rep', { customerConfirmed: true });
    expect(ok.status).toBe(201);
    expect(ok.body.order.status).toBe('confirmed');
    expect(await prismaBase.call.findFirst({ where: { orderId: ok.body.order.id } })).toEqual(expect.objectContaining({ salesRepId: U.rep.id }));

    const denied = await create('rep', { deliveryAgentId: U.agent.id });
    expect(denied.status).toBe(403);
  });

  it('a person or user of the wrong kind cannot be assigned', async () => {
    expect((await create('admin', { customerRepId: U.agent.id })).status).toBe(400);
    expect((await create('admin', { deliveryAgentId: U.rep.id })).status).toBe(400);
    // a user of another tenant does not exist here
    expect((await create('admin', { customerRepId: U.otherAdmin.id })).status).toBe(404);
  });

  it('an existing phone, in any format, links the existing customer and creates no second one; the same phone in another tenant is not linked', async () => {
    const ph = '0245550177';
    const existing = await mkCustomer('Kojo', '+233245550177');
    const other = await mkCustomer('Elsewhere', '+233245550188', otherTenantId);
    const before = await prismaBase.customer.count({ where: { tenantId } });

    const res = await create('admin', { customerPhone: ph, customerName: 'Typed Differently' });
    expect(res.status).toBe(201);
    expect(res.body.order.customerId).toBe(existing.id);
    expect(await prismaBase.customer.count({ where: { tenantId } })).toBe(before);

    // tenant B's customer number, typed in tenant A: a new customer in A, B's row untouched
    const cross = await create('admin', { customerPhone: '0245550188' });
    expect(cross.body.order.customerId).not.toBe(other.id);
    expect((await prismaBase.customer.findUniqueOrThrow({ where: { id: other.id } })).tenantId).toBe(otherTenantId);
  });

  it('checks the current stock number and creates nothing when it is too low', async () => {
    const before = await prismaBase.order.count({ where: { tenantId } });
    const res = await create('admin', { orderItems: [{ productId: productB, quantity: 6, unitPrice: 20 }], totalAmount: 120 });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Insufficient stock');
    expect(res.body.message).toContain('Current stock: 5');
    expect(await prismaBase.order.count({ where: { tenantId } })).toBe(before);
    expect((await create('admin', { orderItems: [{ productId: productB, quantity: 5, unitPrice: 20 }], totalAmount: 100 })).status).toBe(201);
  });

  it('refuses a phone with fewer than 9 digits and a missing total', async () => {
    expect((await create('admin', { customerPhone: '02455501' })).status).toBe(400);
    expect((await create('admin', { customerPhone: '245550123' })).status).toBe(201); // 9 digits, no leading 0
    const { totalAmount: _t, ...noTotal } = body();
    expect((await request(app).post('/api/orders').set(bearer(U.admin.token)).send(noTotal)).status).toBe(400);
  });
});

describe('PUT /api/orders/:id by status group', () => {
  it('before dispatch (pending_confirmation): every F-318 field can change, and the audit row has before and after', async () => {
    const id = await mkOrder('pending_confirmation');
    const ph = phone();
    const res = await edit('admin', id, {
      customerName: 'Efua Mensah', customerEmail: 'efua@example.test', customerPhone: ph, alternatePhone: '0200000011',
      deliveryAddress: '9 New Rd', deliveryState: 'Ashanti', deliveryArea: 'Adum', notes: 'Fix address',
      orderItems: [{ productId: productA, quantity: 3, unitPrice: 50 }, { productId: productB, quantity: 1, unitPrice: 20 }],
      discount: 20, totalAmount: 150,
    });
    expect(res.status).toBe(200);
    const o = await row(id);
    expect(o.customer.firstName).toBe('Efua');
    expect(o.customer.lastName).toBe('Mensah');
    expect(o.customer.email).toBe('efua@example.test');
    expect(o.customer.phoneNumber).toBe(ph);
    expect(o.customer.alternatePhone).toBe('+233200000011');
    expect([o.deliveryAddress, o.deliveryState, o.deliveryArea, o.notes]).toEqual(['9 New Rd', 'Ashanti', 'Adum', 'Fix address']);
    expect(o.orderItems.map((i) => [i.productId, i.quantity, i.totalPrice.toString()]).sort()).toEqual([[productA, 3, '150'], [productB, 1, '20']].sort());
    expect([o.subtotal.toString(), o.discount.toString(), o.totalAmount.toString()]).toEqual(['170', '20', '150']);
    expect(o.codAmount?.toString()).toBe('150'); // the cash to collect followed the total
    expect(res.body.order.status).toBe('pending_confirmation');

    const audit = await prismaBase.auditLog.findFirstOrThrow({ where: { resource: 'order', resourceId: String(id), action: 'update_order' } });
    expect(audit.userId).toBe(U.admin.id);
    expect(audit.before).toEqual(expect.objectContaining({ deliveryAddress: '1 St', totalAmount: '100.00', discount: '0.00', notes: null }));
    expect(audit.after).toEqual(expect.objectContaining({ deliveryAddress: '9 New Rd', totalAmount: '150.00', discount: '20.00', notes: 'Fix address' }));
    expect((audit.metadata as any).fields).toEqual(expect.arrayContaining(['deliveryAddress', 'orderItems', 'totalAmount']));
  });

  it('a save that changes nothing writes no audit row; a field sent back unchanged is not a change', async () => {
    const id = await mkOrder('delivered');
    const res = await edit('admin', id, { deliveryAddress: '1 St', notes: undefined });
    expect(res.status).toBe(200);
    expect(await prismaBase.auditLog.count({ where: { resource: 'order', resourceId: String(id), action: 'update_order' } })).toBe(0);
  });

  it('a confirmed order: a total change needs the confirm tick', async () => {
    const id = await mkOrder('confirmed');
    const refused = await edit('admin', id, { totalAmount: 200 });
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('TOTAL_CHANGE_NOT_CONFIRMED');
    expect(refused.body.message).toBe('The customer confirmed 100.00. The new total is 200.00.');
    expect((await row(id)).totalAmount.toString()).toBe('100');
    const ok = await edit('admin', id, { totalAmount: 200, confirmTotalChange: true });
    expect(ok.status).toBe(200);
    expect((await row(id)).totalAmount.toString()).toBe('200');
  });

  it.each(['payment_pending', 'confirmed', 'preparing', 'ready_for_pickup'])('%s edits items, discount and total with the lines', async (status) => {
    const id = await mkOrder(status);
    const res = await edit('admin', id, { orderItems: [{ productId: productA, quantity: 4, unitPrice: 50 }], discount: 0, confirmTotalChange: true });
    expect(res.status).toBe(200);
    const o = await row(id);
    expect(o.orderItems[0].quantity).toBe(4);
    expect(o.totalAmount.toString()).toBe('200'); // no total sent: lines minus discount
  });

  it.each(['out_for_delivery', 'failed_delivery'])('%s edits phone, alternate phone, address, region, town and notes only', async (status) => {
    const id = await mkOrder(status, { deliveryAgentId: U.agent.id });
    const ok = await edit('admin', id, { alternatePhone: '0200000022', deliveryAddress: '2 Road', deliveryState: 'Ashanti', deliveryArea: 'Adum', notes: 'Gate is blue' });
    expect(ok.status).toBe(200);
    expect((await row(id)).deliveryAddress).toBe('2 Road');

    for (const locked of [{ customerName: 'Someone Else' }, { customerEmail: 'x@y.test' }, { discount: 5 }, { totalAmount: 1 }, { orderItems: [{ productId: productA, quantity: 9, unitPrice: 50 }] }]) {
      const res = await edit('admin', id, locked);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('FIELD_NOT_EDITABLE');
    }
    // the same lines sent back are not a change
    expect((await edit('admin', id, { orderItems: [{ productId: productA, quantity: 2, unitPrice: 50 }], totalAmount: 100 })).status).toBe(200);
    expect((await row(id)).totalAmount.toString()).toBe('100');
  });

  it.each(['delivered', 'returned', 'cancelled'])('%s edits notes only', async (status) => {
    const id = await mkOrder(status);
    expect((await edit('admin', id, { notes: 'Late note' })).status).toBe(200);
    expect((await row(id)).notes).toBe('Late note');
    for (const locked of [{ deliveryAddress: 'Elsewhere' }, { customerPhone: phone() }, { alternatePhone: '0200000033' }, { deliveryState: 'Volta' }]) {
      const res = await edit('admin', id, locked);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('FIELD_NOT_EDITABLE');
    }
  });

  it('refuses an unknown or protected field, and an order with no items', async () => {
    const id = await mkOrder('pending_confirmation');
    expect((await edit('admin', id, { customerRepId: U.rep.id })).status).toBe(400);
    expect((await edit('admin', id, { tenantId: otherTenantId })).status).toBe(400);
    const none = await edit('admin', id, { orderItems: [] });
    expect(none.status).toBe(400);
    expect(none.body.code).toBe('ITEMS_REQUIRED');
    expect(none.body.message).toBe('An order needs at least one item');
  });

  it('a price of 0 is for the owner and admin only; stock is checked for a bigger line', async () => {
    const id = await mkOrder('pending_confirmation');
    const free = { orderItems: [{ productId: productA, quantity: 2, unitPrice: 0 }], totalAmount: 0 };
    expect((await edit('manager', id, free)).status).toBe(403);
    expect((await edit('admin', id, free)).status).toBe(200);
    // already free: a manager may keep it
    expect((await edit('manager', id, { orderItems: [{ productId: productA, quantity: 3, unitPrice: 0 }], totalAmount: 0 })).status).toBe(200);
    const big = await edit('admin', id, { orderItems: [{ productId: productB, quantity: 6, unitPrice: 20 }], totalAmount: 120 });
    expect(big.status).toBe(400);
    expect(big.body.message).toContain('Insufficient stock');
  });
});

describe('PUT /api/orders/:id version check', () => {
  it('a second save with the old updatedAt returns 409 STALE_ORDER; a save with the new one works', async () => {
    const id = await mkOrder('pending_confirmation');
    const first = await request(app).get(`/api/orders/${id}`).set(bearer(U.admin.token));
    const { updatedAt, statusVersion } = first.body.order;
    expect((await edit('admin', id, { notes: 'tab one', updatedAt })).status).toBe(200);

    const stale = await edit('admin', id, { notes: 'tab two', updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_ORDER');
    expect(stale.body.message).toBe('This order changed. Reload to see the new data.');
    expect((await row(id)).notes).toBe('tab one');

    const fresh = await request(app).get(`/api/orders/${id}`).set(bearer(U.admin.token));
    expect((await edit('admin', id, { notes: 'tab two', updatedAt: fresh.body.order.updatedAt })).status).toBe(200);
    expect(statusVersion).toBe(0);
  });

  it('statusVersion: a status move since the read makes the save stale', async () => {
    const id = await mkOrder('pending_confirmation', { customerRepId: U.rep.id });
    const read = await request(app).get(`/api/orders/${id}`).set(bearer(U.admin.token));
    const move = await request(app).patch(`/api/orders/${id}/status`).set(bearer(U.admin.token)).send({ status: 'confirmed' });
    expect(move.status).toBe(200);
    const stale = await edit('admin', id, { notes: 'late', statusVersion: read.body.order.statusVersion });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_ORDER');
    expect((await edit('admin', id, { notes: 'late', statusVersion: read.body.order.statusVersion + 1 })).status).toBe(200);
  });

  it('no version in the body means no version check', async () => {
    const id = await mkOrder('pending_confirmation');
    expect((await edit('admin', id, { notes: 'one' })).status).toBe(200);
    expect((await edit('admin', id, { notes: 'two' })).status).toBe(200);
  });
});

describe('PUT /api/orders/:id phone rules', () => {
  it('a number that belongs to another customer returns 409 with that customer name; nothing changes', async () => {
    const owner = await mkCustomer('Kojo', '+233245550301');
    await prismaBase.customer.update({ where: { id: owner.id }, data: { lastName: 'Agyeman' } });
    const id = await mkOrder('pending_confirmation');
    const res = await edit('admin', id, { customerPhone: '0245550301' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PHONE_BELONGS_TO_OTHER_CUSTOMER');
    expect(res.body.message).toBe('This number belongs to Kojo Agyeman');
    expect(res.body.customerName).toBe('Kojo Agyeman');
    expect(res.body.customerId).toBe(owner.id);
    expect((await row(id)).customer.phoneNumber).not.toBe('+233245550301');
  });

  it('a customer with only this order: the record updates. With other orders: it asks, and updates on Yes', async () => {
    const solo = await mkCustomer('Solo');
    const soloOrder = await mkOrder('pending_confirmation', { customerId: solo.id });
    expect((await edit('admin', soloOrder, { customerPhone: '0245550302' })).status).toBe(200);
    expect((await prismaBase.customer.findUniqueOrThrow({ where: { id: solo.id } })).phoneNumber).toBe('+233245550302');

    const many = await mkCustomer('Many');
    const first = await mkOrder('pending_confirmation', { customerId: many.id });
    await mkOrder('delivered', { customerId: many.id });
    const ask = await edit('admin', first, { customerPhone: '0245550303' });
    expect(ask.status).toBe(409);
    expect(ask.body.code).toBe('PHONE_CHANGE_NEEDS_CONFIRMATION');
    expect(ask.body.otherOrders).toBe(1);
    expect((await prismaBase.customer.findUniqueOrThrow({ where: { id: many.id } })).phoneNumber).not.toBe('+233245550303');

    expect((await edit('admin', first, { customerPhone: '0245550303', confirmPhoneChange: true })).status).toBe(200);
    expect((await prismaBase.customer.findUniqueOrThrow({ where: { id: many.id } })).phoneNumber).toBe('+233245550303');
  });
});

describe('PUT /api/orders/:id who may edit', () => {
  it('a rep edits own order and gets 403 on another rep\'s order; an unassigned order is not theirs', async () => {
    const mine = await mkOrder('pending_confirmation', { customerRepId: U.rep.id });
    const theirs = await mkOrder('pending_confirmation', { customerRepId: U.rep2.id });
    const nobody = await mkOrder('pending_confirmation');
    expect((await edit('rep', mine, { notes: 'mine' })).status).toBe(200);
    expect((await edit('rep', theirs, { notes: 'not mine' })).status).toBe(403);
    expect((await edit('rep', nobody, { notes: 'not mine' })).status).toBe(403);
    expect((await row(theirs)).notes).toBeNull();
  });

  it('a delivery agent cannot edit, even an order on their own delivery', async () => {
    const id = await mkOrder('out_for_delivery', { deliveryAgentId: U.agent.id });
    expect((await edit('agent', id, { notes: 'x' })).status).toBe(403);
  });

  it('two tenants: tenant B cannot edit tenant A\'s order (404) and A\'s data stays', async () => {
    const id = await mkOrder('pending_confirmation');
    const res = await edit('otherAdmin', id, { notes: 'from B' });
    expect(res.status).toBe(404);
    expect((await row(id)).notes).toBeNull();
  });
});

describe('available to sell (M4-T16)', () => {
  let productC: number;
  beforeAll(async () => {
    productC = (await prismaBase.product.create({ data: { sku: `C-${SUFFIX}`, name: 'Reserved set', category: 'x', price: 30, stockQuantity: 0, tenantId } })).id;
    const swiftUser = await prismaBase.user.create({ data: { email: `oce-swift-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Swift', lastName: 'T', role: 'delivery_agent', kind: 'company', tenantId } });
    await stockUp(tenantId, productC, 10, { name: 'Swift', type: 'partner_3pl', userId: swiftUser.id });
    // 6 of the 10 are out for delivery at Swift: 4 are left to sell
    await prismaBase.order.create({
      data: {
        customerId, status: 'out_for_delivery', subtotal: 180, totalAmount: 180, codAmount: 180, tenantId, deliveryAgentId: swiftUser.id,
        deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
        orderItems: { create: [{ productId: productC, quantity: 6, unitPrice: 30, totalPrice: 180 }] },
      } as any,
    });
  });

  it('create compares with on hand less reserved: 4 can be sold, 5 cannot', async () => {
    const line = (quantity: number) => ({ orderItems: [{ productId: productC, quantity, unitPrice: 30 }], totalAmount: quantity * 30 });
    const refused = await create('admin', line(5));
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain('Current stock: 4');
    expect((await create('admin', line(4))).status).toBe(201);
  });

  it('edit compares a bigger line the same way', async () => {
    const id = await mkOrder('pending_confirmation');
    const line = (quantity: number) => ({ orderItems: [{ productId: productC, quantity, unitPrice: 30 }], totalAmount: quantity * 30 });
    // the order made above holds 4 but does not reserve (no delivery partner): the 4 sold above are still counted on hand
    expect((await edit('admin', id, line(5))).status).toBe(400);
    expect((await edit('admin', id, line(5))).body.message).toContain('Insufficient stock');
  });
});
