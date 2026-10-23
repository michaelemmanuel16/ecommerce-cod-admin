/**
 * M3-T03 (COD-22): customerStatsService. The recompute rule on the numbers fixture, idempotence, and the listeners on the
 * order events (created, status changed, deleted).
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { emitOrderCreatedEvent } from '../../utils/appEvents';
import { transitionOrder, TransitionActor } from '../../services/orderStateMachine';
import orderService from '../../services/orderService';
import { customerStatsService, registerCustomerStatsListeners } from '../../services/customerStatsService';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';

jest.setTimeout(180_000);

const SUFFIX = Date.now();
let fixtureTenantId: string;

beforeAll(async () => {
  fixtureTenantId = (await seedFixture(prismaBase)).tenantId;
  registerCustomerStatsListeners();
});

afterAll(async () => {
  await deleteFixtureRows(prismaBase, fixtureTenantId);
  await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  await prismaBase.$disconnect();
});

describe('recompute on the numbers fixture', () => {
  it('counts equal the orders per customer, and a second run changes nothing', async () => {
    const first = await customerStatsService.recomputeTenant(fixtureTenantId);
    expect(first.customers).toBeGreaterThan(0);

    // Independent check with the Prisma client, not the service SQL
    const customers = await prismaBase.customer.findMany({ where: { tenantId: fixtureTenantId } });
    const orders = await prismaBase.order.findMany({
      where: { tenantId: fixtureTenantId, deletedAt: null },
      select: { customerId: true, status: true, failureReason: true, totalAmount: true, createdAt: true },
    });
    const byCustomer = new Map<number, typeof orders>();
    for (const o of orders) byCustomer.set(o.customerId, [...(byCustomer.get(o.customerId) ?? []), o]);

    let mismatches = 0;
    let delivered = 0;
    for (const c of customers) {
      const mine = byCustomer.get(c.id) ?? [];
      const isDelivered = mine.filter((o) => o.status === 'delivered');
      const isRefused = mine.filter((o) => ['failed_delivery', 'returned'].includes(o.status) && o.failureReason === 'refused');
      const value = isDelivered.reduce((sum, o) => sum + Number(o.totalAmount), 0);
      const newest = mine.length ? Math.max(...mine.map((o) => o.createdAt.getTime())) : null;
      const ok = c.totalOrders === mine.length
        && c.deliveredOrders === isDelivered.length
        && c.refusedOrders === isRefused.length
        && Math.abs(Number(c.deliveredValue) - value) < 0.0001
        && (c.lastOrderAt?.getTime() ?? null) === newest;
      if (!ok) mismatches += 1;
      delivered += isDelivered.length;
    }
    expect(mismatches).toBe(0);
    expect(customers.reduce((sum, c) => sum + c.totalOrders, 0)).toBe(orders.length);
    expect(delivered).toBeGreaterThan(0);

    const second = await customerStatsService.recomputeTenant(fixtureTenantId);
    expect(second.changed).toBe(0);
    expect((await customerStatsService.recomputeTenant(fixtureTenantId, { dryRun: true })).changed).toBe(0);
  });
});

describe('listeners on the order events', () => {
  let tenantId: string;
  let customerId: number;
  let adminId: number;
  const actor = (): TransitionActor => ({ kind: 'user', userId: adminId, role: 'admin' });

  const stats = () => prismaBase.customer.findUniqueOrThrow({ where: { id: customerId } });
  /** The listeners run after the event, so wait until the stored value holds. */
  const until = async (check: (c: Awaited<ReturnType<typeof stats>>) => boolean) => {
    for (let i = 0; i < 50; i++) {
      const c = await stats();
      if (check(c)) return c;
      await new Promise((r) => setTimeout(r, 100));
    }
    return stats();
  };
  const mk = async (status: any, extra: Record<string, unknown> = {}) =>
    prismaBase.order.create({ data: { customerId, status, subtotal: 100, totalAmount: 100, tenantId, ...extra } as any });

  beforeAll(async () => {
    tenantId = (await createTenant('Stats Tenant')).id;
    customerId = (await prismaBase.customer.create({
      data: { firstName: 'Yaw', lastName: 'Boateng', phoneNumber: `+2332${String(SUFFIX).slice(-8)}`, address: '1 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
    })).id;
    adminId = (await prismaBase.user.create({
      data: { email: `stats-admin-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Ada', lastName: 'Admin', role: 'admin', tenantId },
    })).id;
  }, 30000);

  afterAll(async () => {
    await deleteTenantRows([tenantId]);
  });

  it('order.created raises totalOrders and lastOrderAt', async () => {
    const order = await mk('pending_confirmation');
    emitOrderCreatedEvent(order);
    const c = await until((x) => x.totalOrders === 1);
    expect(c.totalOrders).toBe(1);
    expect(c.lastOrderAt?.getTime()).toBe(order.createdAt.getTime());
  });

  it('delivered then returned (refused) moves deliveredOrders and refusedOrders', async () => {
    const order = await mk('out_for_delivery');
    emitOrderCreatedEvent(order);
    await until((x) => x.totalOrders === 2);

    await runInTenant(tenantId, () => transitionOrder(order.id, 'delivered', actor()));
    let c = await until((x) => x.deliveredOrders === 1);
    expect(c.deliveredOrders).toBe(1);
    expect(Number(c.deliveredValue)).toBe(100);
    expect(c.refusedOrders).toBe(0);

    await runInTenant(tenantId, () => transitionOrder(order.id, 'returned', actor(), { failureReason: 'refused' }));
    c = await until((x) => x.deliveredOrders === 0);
    expect(c.deliveredOrders).toBe(0);
    expect(Number(c.deliveredValue)).toBe(0);
    expect(c.refusedOrders).toBe(1);
    expect(c.totalOrders).toBe(2);
  });

  it('a failed delivery with another reason is not a refusal', async () => {
    const order = await mk('out_for_delivery');
    await runInTenant(tenantId, () => transitionOrder(order.id, 'failed_delivery', actor(), { failureReason: 'not_reachable' }));
    const c = await until((x) => x.totalOrders === 3);
    expect(c.refusedOrders).toBe(1);
  });

  it('deleting an order lowers totalOrders', async () => {
    const order = await mk('pending_confirmation');
    emitOrderCreatedEvent(order);
    await until((x) => x.totalOrders === 4);
    await runInTenant(tenantId, () => orderService.deleteOrder(order.id, adminId));
    const c = await until((x) => x.totalOrders === 3);
    expect(c.totalOrders).toBe(3);
  });

  it('a customer with no orders left reads zeros and a null lastOrderAt', async () => {
    await prismaBase.order.updateMany({ where: { customerId }, data: { deletedAt: new Date() } });
    expect(await customerStatsService.recompute(customerId)).toBe(true);
    const c = await stats();
    expect([c.totalOrders, c.deliveredOrders, c.refusedOrders, Number(c.deliveredValue), c.lastOrderAt]).toEqual([0, 0, 0, 0, null]);
    expect(await customerStatsService.recompute(customerId)).toBe(false);
  });
});
