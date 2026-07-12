/**
 * Integration tests for the MCP `orders_update_status` write tool.
 *
 * Exercises the real handler (updateOrderStatusTool) against a live test DB,
 * inside a tenant context, proving:
 *   - a real status change delegates to orderService and writes an audit row
 *   - the idempotency guard makes no change (and no new history) when already set
 *   - unknown orders return a clean error
 *   - the tenant-isolation extension makes cross-tenant updates impossible
 *
 * Uses `confirmed -> preparing`: a transition that touches neither inventory
 * (deducted zone is out_for_delivery/delivered) nor the GL (returned only),
 * so assertions stay deterministic.
 */

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { prismaBase } from '../../utils/prisma';
import { tenantStorage } from '../../utils/tenantContext';
import { updateOrderStatusTool } from '../../mcp/tools/ordersWrite';

// orderService may emit socket events / log — stub both, as the other
// integration suites do.
jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({
    to: jest.fn(() => ({ emit: jest.fn() })),
    emit: jest.fn(),
  })),
  hasSocketInstance: jest.fn(() => true),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const SUFFIX = Date.now();

let tenantAId: string;
let tenantBId: string;
let orderAId: number;
let orderBId: number;

// Parse the JSON payload an MCP tool returns in content[0].text.
function payload(res: any) {
  return JSON.parse(res.content[0].text);
}
// Run a tool call inside a given tenant's context.
function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStorage.run({ tenantId }, fn);
}

beforeAll(async () => {
  const [tenantA, tenantB] = await Promise.all([
    prismaBase.tenant.create({ data: { name: `MCP Tenant A ${SUFFIX}`, slug: `mcp-a-${SUFFIX}` } }),
    prismaBase.tenant.create({ data: { name: `MCP Tenant B ${SUFFIX}`, slug: `mcp-b-${SUFFIX}` } }),
  ]);
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;

  const [custA, custB] = await Promise.all([
    prismaBase.customer.create({
      data: {
        firstName: 'Ama', lastName: 'Mensah',
        phoneNumber: `+2331${SUFFIX}`.slice(0, 15),
        address: '1 Test St', state: 'Greater Accra', area: 'Accra', tenantId: tenantAId,
      },
    }),
    prismaBase.customer.create({
      data: {
        firstName: 'Bola', lastName: 'Ade',
        phoneNumber: `+2332${SUFFIX}`.slice(0, 15),
        address: '2 Test St', state: 'Greater Accra', area: 'Accra', tenantId: tenantBId,
      },
    }),
  ]);

  const [orderA, orderB] = await Promise.all([
    prismaBase.order.create({
      data: {
        customerId: custA.id, status: 'confirmed',
        subtotal: 100, shippingCost: 0, totalAmount: 100,
        deliveryAddress: '1 Test St', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
        tenantId: tenantAId,
      },
    }),
    prismaBase.order.create({
      data: {
        customerId: custB.id, status: 'confirmed',
        subtotal: 100, shippingCost: 0, totalAmount: 100,
        deliveryAddress: '2 Test St', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
        tenantId: tenantBId,
      },
    }),
  ]);
  orderAId = orderA.id;
  orderBId = orderB.id;
});

afterAll(async () => {
  const ids = [tenantAId, tenantBId];
  await prismaBase.orderHistory.deleteMany({ where: { order: { tenantId: { in: ids } } } });
  await prismaBase.order.deleteMany({ where: { tenantId: { in: ids } } });
  await prismaBase.customer.deleteMany({ where: { tenantId: { in: ids } } });
  await prismaBase.tenant.deleteMany({ where: { id: { in: ids } } });
  await prismaBase.$disconnect();
});

describe('orders_update_status MCP tool', () => {
  it('updates status, returns previous/new, and writes an OrderHistory row', async () => {
    const res = await asTenant(tenantAId, () =>
      updateOrderStatusTool({ orderId: orderAId, status: 'preparing' }),
    );
    const body = payload(res);

    expect(res.isError).toBeUndefined();
    expect(body).toMatchObject({
      updated: true,
      orderId: orderAId,
      previousStatus: 'confirmed',
      newStatus: 'preparing',
      customer: 'Ama Mensah',
    });

    const dbOrder = await prismaBase.order.findUnique({ where: { id: orderAId } });
    expect(dbOrder?.status).toBe('preparing');

    const history = await prismaBase.orderHistory.findMany({
      where: { orderId: orderAId, status: 'preparing' },
    });
    expect(history.length).toBe(1);
  });

  it('is idempotent: no change and no new history when already in target status', async () => {
    const before = await prismaBase.orderHistory.count({ where: { orderId: orderAId } });

    const res = await asTenant(tenantAId, () =>
      updateOrderStatusTool({ orderId: orderAId, status: 'preparing' }),
    );
    const body = payload(res);

    expect(res.isError).toBeUndefined();
    expect(body.updated).toBe(false);
    expect(body.message).toMatch(/already/i);

    const after = await prismaBase.orderHistory.count({ where: { orderId: orderAId } });
    expect(after).toBe(before);
  });

  it('returns an error for an unknown order', async () => {
    const res = await asTenant(tenantAId, () =>
      updateOrderStatusTool({ orderId: 999_999_999, status: 'delivered' }),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not found/i);
  });

  it('cannot update an order that belongs to another tenant', async () => {
    // Tenant A context, targeting Tenant B's order.
    const res = await asTenant(tenantAId, () =>
      updateOrderStatusTool({ orderId: orderBId, status: 'cancelled' }),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not found/i);

    // Tenant B's order is untouched.
    const orderB = await prismaBase.order.findUnique({ where: { id: orderBId } });
    expect(orderB?.status).toBe('confirmed');
  });

  // These two cases move orderAId into the inventory-deducted zone
  // (delivered), so they must run last, after all cases above that assume
  // `confirmed -> preparing`.
  it('honours an explicit deliveryDate when marking delivered', async () => {
    const res = await asTenant(tenantAId, () =>
      updateOrderStatusTool({
        orderId: orderAId,
        status: 'delivered',
        deliveryDate: '2026-06-17',
        notes: 'Logiswift ESD123 · shipped 2026-06-15',
      }),
    );

    expect(payload(res).updated).toBe(true);

    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: orderAId } });
    expect(order.deliveryDate?.toISOString().slice(0, 10)).toBe('2026-06-17');
  });

  it('rejects a malformed deliveryDate rather than silently using today', async () => {
    const res = await asTenant(tenantAId, () =>
      updateOrderStatusTool({ orderId: orderAId, status: 'returned', deliveryDate: '17/06/2026' }),
    );

    expect(res.content[0].text).toMatch(/deliveryDate/i);
  });

  // These three cases exercise the calendar-validity guard on top of the
  // schema's digit-shape regex. JS's Date silently rolls impossible calendar
  // days into the next month (2026-02-30 -> 2026-03-02; 2026-02-29 ->
  // 2026-03-01 since 2026 isn't a leap year), which would post GL revenue
  // into the wrong accounting period if not caught. They run after the
  // deliveryDate cases above, so orderAId is already 'delivered' with
  // deliveryDate '2026-06-17'.
  it('rejects a calendar-invalid deliveryDate (2026-02-30) instead of rolling it forward', async () => {
    const res = await asTenant(tenantAId, () =>
      updateOrderStatusTool({ orderId: orderAId, status: 'returned', deliveryDate: '2026-02-30' }),
    );

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/deliveryDate/i);
    expect(res.content[0].text).toMatch(/2026-02-30/);

    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: orderAId } });
    expect(order.status).toBe('delivered');
    expect(order.deliveryDate?.toISOString().slice(0, 10)).toBe('2026-06-17');
  });

  it('rejects Feb 29 in a non-leap year (2026-02-29) instead of rolling it forward', async () => {
    const res = await asTenant(tenantAId, () =>
      updateOrderStatusTool({ orderId: orderAId, status: 'returned', deliveryDate: '2026-02-29' }),
    );

    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/deliveryDate/i);
    expect(res.content[0].text).toMatch(/2026-02-29/);

    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: orderAId } });
    expect(order.status).toBe('delivered');
    expect(order.deliveryDate?.toISOString().slice(0, 10)).toBe('2026-06-17');
  });

  it('still accepts a valid leap-year deliveryDate (2028-02-29)', async () => {
    // Reset off 'delivered' first: the tool's idempotency guard would
    // otherwise no-op a second 'delivered' call before deliveryDate is ever
    // applied, since orderAId is already 'delivered' from the case above.
    await asTenant(tenantAId, () =>
      updateOrderStatusTool({ orderId: orderAId, status: 'confirmed' }),
    );

    const res = await asTenant(tenantAId, () =>
      updateOrderStatusTool({ orderId: orderAId, status: 'delivered', deliveryDate: '2028-02-29' }),
    );
    const body = payload(res);

    expect(res.isError).toBeUndefined();
    expect(body.updated).toBe(true);

    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: orderAId } });
    expect(order.deliveryDate?.toISOString().slice(0, 10)).toBe('2028-02-29');
  });
});
