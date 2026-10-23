/**
 * M4-T18 (COD-42): backfill of Order.failureReason from free text (F-705). Throwaway tenants on the test DB.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { makeCustomer, makeOrder } from './helpers/kpiOrders';
import { backfillFailureReasons } from '../../services/failureReasonBackfill';

let a: string;
let b: string;
const ids: Record<string, number> = {};

const history = (tenantId: string, orderId: number, status: 'failed_delivery' | 'returned', notes: string | null, metadata: object | null, at: string) =>
  prismaBase.orderHistory.create({
    data: { tenantId, orderId, status, notes, metadata: metadata ?? undefined, actorKind: 'user', createdAt: new Date(at) },
  });

const reasonOf = async (key: string) => (await prismaBase.order.findUniqueOrThrow({ where: { id: ids[key] } })).failureReason;

beforeAll(async () => {
  a = (await createTenant('Backfill A')).id;
  b = (await createTenant('Backfill B')).id;
  const ca = (await makeCustomer(a)).id;
  const cb = (await makeCustomer(b)).id;

  ids.refused = (await makeOrder({ tenantId: a, customerId: ca, status: 'failed_delivery' })).id;
  // An older row says one thing, the latest row another: the latest row wins
  await history(a, ids.refused, 'failed_delivery', 'Delivery failed: not reachable', null, '2026-10-01T10:00:00Z');
  await history(a, ids.refused, 'failed_delivery', 'Delivery failed: customer refused', null, '2026-10-02T10:00:00Z');

  ids.wrong = (await makeOrder({ tenantId: a, customerId: ca, status: 'failed_delivery' })).id;
  await history(a, ids.wrong, 'failed_delivery', null, { reason: 'Wrong address' }, '2026-10-02T10:00:00Z');

  ids.unreachable = (await makeOrder({ tenantId: a, customerId: ca, status: 'failed_delivery' })).id;
  await prismaBase.delivery.create({ data: { tenantId: a, orderId: ids.unreachable, notes: 'Failed delivery attempt: not reachable' } });

  ids.resched = (await makeOrder({ tenantId: a, customerId: ca, status: 'failed_delivery' })).id;
  await history(a, ids.resched, 'failed_delivery', 'Delivery failed: asked for later', { reschedule: true }, '2026-10-02T10:00:00Z');

  ids.returnedNoText = (await makeOrder({ tenantId: a, customerId: ca, status: 'returned' })).id;
  await history(a, ids.returnedNoText, 'returned', null, null, '2026-10-03T10:00:00Z');

  // Not touched: already has a reason, delivered, deleted, another tenant
  ids.keep = (await makeOrder({ tenantId: a, customerId: ca, status: 'failed_delivery' })).id;
  await prismaBase.order.update({ where: { id: ids.keep }, data: { failureReason: 'refused' } });
  await history(a, ids.keep, 'failed_delivery', 'wrong address', null, '2026-10-02T10:00:00Z');
  ids.delivered = (await makeOrder({ tenantId: a, customerId: ca, status: 'delivered' })).id;
  ids.deleted = (await makeOrder({ tenantId: a, customerId: ca, status: 'failed_delivery' })).id;
  await prismaBase.order.update({ where: { id: ids.deleted }, data: { deletedAt: new Date() } });
  ids.other = (await makeOrder({ tenantId: b, customerId: cb, status: 'failed_delivery' })).id;
  await history(b, ids.other, 'failed_delivery', 'customer refused', null, '2026-10-02T10:00:00Z');
});

afterAll(async () => {
  await deleteTenantRows([a, b]);
  await prismaBase.$disconnect();
});

describe('backfillFailureReasons', () => {
  it('dry run prints the counts per reason and writes nothing', async () => {
    const r = await backfillFailureReasons(a, { dryRun: true });
    expect(r).toEqual({ orders: 5, counts: { not_reachable: 1, refused: 1, wrong_address: 1, rescheduled: 1, other: 1 } });
    for (const key of ['refused', 'wrong', 'unreachable', 'resched', 'returnedNoText']) expect(await reasonOf(key)).toBeNull();
  });

  it('writes the reasons and leaves the other rows alone', async () => {
    const r = await backfillFailureReasons(a);
    expect(r.orders).toBe(5);
    expect(await reasonOf('refused')).toBe('refused');
    expect(await reasonOf('wrong')).toBe('wrong_address');
    expect(await reasonOf('unreachable')).toBe('not_reachable');
    expect(await reasonOf('resched')).toBe('rescheduled');
    expect(await reasonOf('returnedNoText')).toBe('other');
    expect(await reasonOf('keep')).toBe('refused'); // had a reason, text says otherwise
    expect(await reasonOf('delivered')).toBeNull();
    expect(await reasonOf('deleted')).toBeNull();
    expect(await reasonOf('other')).toBeNull(); // tenant B
  });

  it('is idempotent: a second run changes nothing', async () => {
    const before = await prismaBase.order.findMany({ where: { tenantId: a }, select: { id: true, failureReason: true, updatedAt: true }, orderBy: { id: 'asc' } });
    const r = await backfillFailureReasons(a);
    expect(r).toEqual({ orders: 0, counts: { not_reachable: 0, refused: 0, wrong_address: 0, rescheduled: 0, other: 0 } });
    expect(await prismaBase.order.findMany({ where: { tenantId: a }, select: { id: true, failureReason: true, updatedAt: true }, orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('runs per tenant: tenant B is filled by its own run', async () => {
    const r = await backfillFailureReasons(b);
    expect(r.counts.refused).toBe(1);
    expect(await reasonOf('other')).toBe('refused');
  });
});
