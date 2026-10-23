/**
 * M3-T12 (COD-23): bulk status, bulk and single assign, single and bulk delete (F-313 to F-316).
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
const U: Record<string, { id: number; email: string; role: string; token: string }> = {};

const mkUser = async (label: string, role: any, extra: Record<string, unknown> = {}) => {
  const u = await prismaBase.user.create({
    data: { email: `om-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'Mut', role, tenantId, ...extra },
  });
  U[label] = { id: u.id, email: u.email, role, token: generateAccessToken({ id: u.id, email: u.email, role, tenantId }) };
};
const orderData = (status: string, extra: Record<string, unknown> = {}) => ({
  customerId, status, subtotal: 10, totalAmount: 10, codAmount: 10, tenantId,
  deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra', ...extra,
}) as any;
const mkOrder = async (status: string, extra: Record<string, unknown> = {}) =>
  (await prismaBase.order.create({ data: orderData(status, extra) })).id;
const mkOrders = async (n: number, status: string, extra: Record<string, unknown> = {}) => {
  const ids: number[] = [];
  for (let i = 0; i < n; i += 100) {
    const size = Math.min(100, n - i);
    await prismaBase.order.createMany({ data: Array.from({ length: size }, () => orderData(status, { notes: `batch-${SUFFIX}-${n}`, ...extra })) });
  }
  const rows = await prismaBase.order.findMany({ where: { tenantId, notes: `batch-${SUFFIX}-${n}`, status: status as any }, select: { id: true }, orderBy: { id: 'desc' }, take: n });
  rows.forEach((r) => ids.push(r.id));
  await prismaBase.order.updateMany({ where: { id: { in: ids } }, data: { notes: null } });
  return ids;
};
const bulkStatus = (who: string, body: Record<string, unknown>) =>
  request(app).patch('/api/orders/bulk/status').set(bearer(U[who].token)).send(body);
const bulkAssign = (who: string, body: Record<string, unknown>) =>
  request(app).patch('/api/orders/bulk/assign').set(bearer(U[who].token)).send(body);
const del = (who: string, id: number) => request(app).delete(`/api/orders/${id}`).set(bearer(U[who].token));
const bulkDel = (who: string, ids: number[]) => request(app).delete('/api/orders/bulk').set(bearer(U[who].token)).send({ ids });

beforeAll(async () => {
  tenantId = (await createTenant('Orders Mutation')).id;
  otherTenantId = (await createTenant('Orders Mutation Other')).id;
  await seedTenantDefaults(tenantId);
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-8)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  await mkUser('admin', 'admin');
  await mkUser('rep', 'sales_rep');
  await mkUser('rep2', 'sales_rep');
  await mkUser('agent', 'delivery_agent');
  await mkUser('blocked', 'delivery_agent');
  await mkUser('away', 'delivery_agent', { isAvailable: false });
  await mkUser('gone', 'sales_rep', { isActive: false });
  await prismaBase.agentBalance.create({ data: { agentId: U.blocked.id, isBlocked: true, tenantId } });
}, 60_000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('PATCH /api/orders/bulk/status', () => {
  it('20 orders with 2 invalid moves: 18 succeeded, 2 failed with codes', async () => {
    const good = await mkOrders(18, 'pending_confirmation');
    const bad = [await mkOrder('delivered'), await mkOrder('cancelled')];
    const res = await bulkStatus('admin', { orderIds: [...good, ...bad], status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.succeeded.sort()).toEqual([...good].sort());
    expect(res.body.failed).toHaveLength(2);
    expect(res.body.failed.map((f: any) => f.id).sort()).toEqual([...bad].sort());
    expect(res.body.failed.every((f: any) => f.code === 'INVALID_TRANSITION' && typeof f.message === 'string')).toBe(true);

    const moved = await prismaBase.order.findMany({ where: { id: { in: good } }, select: { status: true } });
    expect(moved.every((o) => o.status === 'confirmed')).toBe(true);
    // Each success has its own history row from the machine
    const rows = await prismaBase.orderHistory.findMany({ where: { orderId: { in: good }, status: 'confirmed', fromStatus: 'pending_confirmation' } });
    expect(rows).toHaveLength(18);
    // The failed ones did not move
    expect((await prismaBase.order.findMany({ where: { id: { in: bad } }, select: { status: true } })).map((o) => o.status).sort()).toEqual(['cancelled', 'delivered']);
  });

  it('a missing order is listed with its code; failed_delivery needs no reason (COD-139)', async () => {
    const out = await mkOrder('out_for_delivery', { deliveryAgentId: U.agent.id });
    const res = await bulkStatus('admin', { orderIds: [out, 999999999], status: 'failed_delivery' });
    expect(res.body.succeeded).toEqual([out]);
    const codes = Object.fromEntries(res.body.failed.map((f: any) => [f.id, f.code]));
    expect(codes).toEqual({ 999999999: 'NOT_FOUND' });
  });

  it('a rep moves own orders only', async () => {
    const mine = await mkOrder('pending_confirmation', { customerRepId: U.rep.id });
    const theirs = await mkOrder('pending_confirmation', { customerRepId: U.rep2.id });
    const res = await bulkStatus('rep', { orderIds: [mine, theirs], status: 'confirmed' });
    expect(res.body.succeeded).toEqual([mine]);
    expect(res.body.failed).toEqual([expect.objectContaining({ id: theirs, code: 'FORBIDDEN' })]);
  });

  it('200 orders are accepted, 201 are refused with 413', async () => {
    const res = await bulkStatus('admin', { orderIds: Array.from({ length: 201 }, (_, i) => i + 1), status: 'confirmed' });
    expect(res.status).toBe(413);
    expect(res.body.error ?? res.body.message).toBe('Select 200 orders or fewer.');
  });

  it('400 for an unknown status or no ids', async () => {
    expect((await bulkStatus('admin', { orderIds: [1], status: 'shipped' })).status).toBe(400);
    expect((await bulkStatus('admin', { orderIds: [], status: 'confirmed' })).status).toBe(400);
  });

  it('401 with no token; the other tenant order is NOT_FOUND', async () => {
    expect((await request(app).patch('/api/orders/bulk/status').send({ orderIds: [1], status: 'confirmed' })).status).toBe(401);
    const otherCustomer = await prismaBase.customer.create({
      data: { firstName: 'Zed', lastName: 'Other', phoneNumber: `+2332${String(SUFFIX + 1).slice(-8)}`, address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId: otherTenantId },
    });
    const foreign = (await prismaBase.order.create({ data: orderData('pending_confirmation', { customerId: otherCustomer.id, tenantId: otherTenantId }) })).id;
    const res = await bulkStatus('admin', { orderIds: [foreign], status: 'confirmed' });
    expect(res.body.failed).toEqual([expect.objectContaining({ id: foreign, code: 'NOT_FOUND' })]);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: foreign } })).status).toBe('pending_confirmation');
  });
});

describe('assign', () => {
  it('bulk assign of 200 orders works: history row and notification each', async () => {
    const ids = await mkOrders(200, 'pending_confirmation');
    const res = await bulkAssign('admin', { orderIds: ids, customerRepId: U.rep.id });
    expect(res.status).toBe(200);
    expect(res.body.succeeded).toHaveLength(200);
    expect(res.body.failed).toEqual([]);
    expect(await prismaBase.order.count({ where: { id: { in: ids }, customerRepId: U.rep.id } })).toBe(200);
    expect(await prismaBase.orderHistory.count({ where: { orderId: { in: ids }, notes: { contains: 'Customer rep assigned' } } })).toBe(200);
    expect(await prismaBase.notification.count({ where: { userId: U.rep.id, title: 'Order assigned to you', tenantId } })).toBeGreaterThanOrEqual(200);
  });

  it('201 orders are rejected with 413', async () => {
    const res = await bulkAssign('admin', { orderIds: Array.from({ length: 201 }, (_, i) => i + 1), customerRepId: U.rep.id });
    expect(res.status).toBe(413);
  });

  it('needs a rep or an agent; a rep cannot assign', async () => {
    const id = await mkOrder('confirmed');
    expect((await bulkAssign('admin', { orderIds: [id] })).status).toBe(400);
    expect((await bulkAssign('rep', { orderIds: [id], customerRepId: U.rep.id })).status).toBe(403);
  });

  it('a blocked partner needs a confirm; an unavailable one is refused; a deactivated rep is not found', async () => {
    const id = await mkOrder('confirmed');
    const blocked = await bulkAssign('admin', { orderIds: [id], deliveryAgentId: U.blocked.id });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code ?? blocked.body.errorCode).toBe('PARTNER_BLOCKED');
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).deliveryAgentId).toBeNull();

    const confirmed = await bulkAssign('admin', { orderIds: [id], deliveryAgentId: U.blocked.id, confirmBlocked: true });
    expect(confirmed.body.succeeded).toEqual([id]);

    const away = await bulkAssign('admin', { orderIds: [id], deliveryAgentId: U.away.id });
    expect(away.status).toBe(400);
    expect(away.body.code ?? away.body.errorCode).toBe('PARTNER_UNAVAILABLE');

    const gone = await bulkAssign('admin', { orderIds: [id], customerRepId: U.gone.id });
    expect(gone.status).toBe(404);
  });

  it('a closed order keeps its delivery agent; the rest of the batch is assigned', async () => {
    const open = await mkOrder('out_for_delivery', { deliveryAgentId: U.blocked.id });
    const closed = await mkOrder('delivered', { deliveryAgentId: U.blocked.id });
    const res = await bulkAssign('admin', { orderIds: [open, closed], deliveryAgentId: U.agent.id });
    expect(res.body.succeeded).toEqual([open]);
    expect(res.body.failed).toEqual([expect.objectContaining({ id: closed, code: 'ORDER_CLOSED' })]);
    // The history row of the reassign names both partners
    const row = await prismaBase.orderHistory.findFirstOrThrow({ where: { orderId: open, notes: { contains: 'Delivery agent assigned' } } });
    expect(row.notes).toContain('agent Mut');
    expect(row.notes).toContain('(was blocked Mut)');
  });

  it('single assign writes a history row and notifies the assignee', async () => {
    const id = await mkOrder('pending_confirmation');
    const res = await request(app).patch(`/api/orders/${id}/assign-rep`).set(bearer(U.admin.token)).send({ customerRepId: U.rep2.id });
    expect(res.status).toBe(200);
    expect(res.body.order.customerRepId).toBe(U.rep2.id);
    const history = await prismaBase.orderHistory.findFirstOrThrow({ where: { orderId: id, notes: { contains: 'Customer rep assigned' } } });
    expect(history.notes).toBe('Customer rep assigned: rep2 Mut by admin Mut');
    const note = await prismaBase.notification.findFirstOrThrow({ where: { userId: U.rep2.id, tenantId } });
    expect(note).toMatchObject({ type: 'order', title: 'Order assigned to you' });
    expect(note.message).toContain(`#${id}`);
    expect((note.data as any).orderId).toBe(id);
  });
});

describe('unassign both (F-314)', () => {
  it('single: clears both, one history row, no notification', async () => {
    const id = await mkOrder('confirmed', { customerRepId: U.rep.id, deliveryAgentId: U.agent.id });
    const before = await prismaBase.notification.count({ where: { tenantId } });
    const res = await request(app).patch(`/api/orders/${id}/assign-rep`).set(bearer(U.admin.token)).send({ unassign: 'both' });
    expect(res.status).toBe(200);
    expect(res.body.order).toMatchObject({ customerRepId: null, deliveryAgentId: null });
    const row = await prismaBase.orderHistory.findMany({ where: { orderId: id, notes: { contains: 'removed by' } } });
    expect(row).toHaveLength(1);
    expect(row[0].notes).toBe('Call rep and delivery agent removed by admin Mut');
    expect(await prismaBase.notification.count({ where: { tenantId } })).toBe(before);
    // assign-agent takes the same body
    const id2 = await mkOrder('confirmed', { customerRepId: U.rep.id });
    expect((await request(app).patch(`/api/orders/${id2}/assign-agent`).set(bearer(U.admin.token)).send({ unassign: 'both' })).status).toBe(200);
  });

  it('bulk of 3 succeeds; a closed order fails with ORDER_CLOSED; a rep gets 403', async () => {
    const ids = [1, 2, 3].map(() => mkOrder('confirmed', { customerRepId: U.rep.id, deliveryAgentId: U.agent.id }));
    const done = await Promise.all(ids);
    const res = await bulkAssign('admin', { orderIds: done, unassign: 'both' });
    expect(res.body.succeeded.sort()).toEqual([...done].sort());
    expect(res.body.failed).toEqual([]);
    expect(await prismaBase.order.count({ where: { id: { in: done }, customerRepId: null, deliveryAgentId: null } })).toBe(3);

    const closed = await mkOrder('delivered', { customerRepId: U.rep.id, deliveryAgentId: U.agent.id });
    const mixed = await bulkAssign('admin', { orderIds: [closed], unassign: 'both' });
    expect(mixed.body.failed).toEqual([expect.objectContaining({ id: closed, code: 'ORDER_CLOSED' })]);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: closed } })).deliveryAgentId).toBe(U.agent.id);
    expect((await bulkAssign('rep', { orderIds: done, unassign: 'both' })).status).toBe(403);
    expect((await bulkAssign('admin', { orderIds: Array.from({ length: 201 }, (_, i) => i + 1), unassign: 'both' })).status).toBe(413);
  });
});

describe('DELETE /api/orders/:id (F-316)', () => {
  it.each([
    ['pending_confirmation'], ['payment_pending'], ['payment_failed'], ['confirmed'], ['preparing'], ['ready_for_pickup'], ['cancelled'], ['failed_delivery'],
  ])('%s can be deleted', async (status) => {
    const id = await mkOrder(status);
    const res = await del('admin', id);
    expect(res.status).toBe(200);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
  });

  it.each([['out_for_delivery'], ['delivered'], ['digital_delivered'], ['returned']])('%s is refused with 409', async (status) => {
    const id = await mkOrder(status);
    const res = await del('admin', id);
    expect(res.status).toBe(409);
    expect(res.body.error ?? res.body.message).toBe('Cancel or return the order first.');
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).deletedAt).toBeNull();
  });

  it('writes an audit row with the id, removes a draft AgentCollection and keeps a later one', async () => {
    const id = await mkOrder('confirmed', { deliveryAgentId: U.agent.id });
    await prismaBase.agentCollection.create({ data: { orderId: id, agentId: U.agent.id, amount: 10, status: 'draft', collectionDate: new Date(), tenantId } });
    expect((await del('admin', id)).status).toBe(200);
    expect(await prismaBase.agentCollection.count({ where: { orderId: id } })).toBe(0);
    const audit = await prismaBase.auditLog.findFirstOrThrow({ where: { tenantId, resource: 'order', resourceId: String(id), action: 'delete_order' } });
    expect((audit.metadata as any).orderIds).toEqual([id]);
    expect(audit.userId).toBe(U.admin.id);

    const kept = await mkOrder('failed_delivery', { deliveryAgentId: U.agent.id });
    await prismaBase.agentCollection.create({ data: { orderId: kept, agentId: U.agent.id, amount: 10, status: 'verified', collectionDate: new Date(), tenantId } });
    expect((await del('admin', kept)).status).toBe(200);
    expect(await prismaBase.agentCollection.count({ where: { orderId: kept } })).toBe(1);
  });

  it('404 for a missing order; a rep cannot delete', async () => {
    expect((await del('admin', 999999999)).status).toBe(404);
    const id = await mkOrder('pending_confirmation', { customerRepId: U.rep.id });
    expect((await del('rep', id)).status).toBe(403);
  });
});

describe('DELETE /api/orders/bulk (F-315)', () => {
  it('deletes what it can, lists the rest, and writes one audit row with the id list', async () => {
    const ok = [await mkOrder('pending_confirmation'), await mkOrder('cancelled'), await mkOrder('confirmed')];
    const blocked = [await mkOrder('out_for_delivery'), await mkOrder('delivered')];
    const res = await bulkDel('admin', [...ok, ...blocked, 999999999]);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(3);
    expect(res.body.deletedCount).toBe(3);
    expect(res.body.skipped).toEqual(expect.arrayContaining([
      { id: blocked[0], reason: 'Cancel or return the order first.' },
      { id: blocked[1], reason: 'Cancel or return the order first.' },
      { id: 999999999, reason: 'Order not found' },
    ]));
    expect(res.body.skipped).toHaveLength(3);

    const audits = await prismaBase.auditLog.findMany({ where: { tenantId, action: 'bulk_delete_orders' } });
    const audit = audits.find((a) => ((a.metadata as any).orderIds as number[]).includes(ok[0]))!;
    expect((audit.metadata as any).orderIds.sort()).toEqual([...ok].sort());
    expect(audits.filter((a) => ((a.metadata as any).orderIds as number[]).includes(ok[0]))).toHaveLength(1);
    expect(await prismaBase.order.count({ where: { id: { in: ok }, deletedAt: { not: null } } })).toBe(3);
  });

  it('none deletable: 200 with deleted 0 and every order skipped', async () => {
    const id = await mkOrder('delivered');
    const res = await bulkDel('admin', [id]);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ deleted: 0, skipped: [{ id, reason: 'Cancel or return the order first.' }] });
  });

  it('more than 100 ids is 400; a rep gets 403', async () => {
    expect((await bulkDel('admin', Array.from({ length: 101 }, (_, i) => i + 1))).status).toBe(400);
    expect((await bulkDel('rep', [1])).status).toBe(403);
  });
});
