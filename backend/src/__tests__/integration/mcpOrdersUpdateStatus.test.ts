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

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import { prismaBase } from '../../utils/prisma';
import { updateOrderStatusTool } from '../../mcp/tools/ordersWrite';
import { createTwoTenants, asTenant, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
let orderAId: number;
let orderBId: number;

// Parse the JSON payload an MCP tool returns in content[0].text.
function payload(res: any) {
  return JSON.parse(res.content[0].text);
}

beforeAll(async () => {
  pair = await createTwoTenants('mcpwrite');
  orderAId = pair.a.ids.order;
  orderBId = pair.b.ids.order;

  // The helper order is out_for_delivery; these cases start from confirmed.
  await prismaBase.order.updateMany({ where: { id: { in: [orderAId, orderBId] } }, data: { status: 'confirmed' } });
  await prismaBase.customer.update({ where: { id: pair.a.ids.customer }, data: { firstName: 'Ama', lastName: 'Mensah' } });
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('orders_update_status MCP tool', () => {
  it('updates status, returns previous/new, and writes an OrderHistory row', async () => {
    const res = await asTenant(pair.a, () =>
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

    const res = await asTenant(pair.a, () =>
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
    const res = await asTenant(pair.a, () =>
      updateOrderStatusTool({ orderId: 999_999_999, status: 'delivered' }),
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not found/i);
  });

  it('cannot update an order that belongs to another tenant', async () => {
    // Tenant A context, targeting Tenant B's order.
    const res = await asTenant(pair.a, () =>
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
    const res = await asTenant(pair.a, () =>
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
    const res = await asTenant(pair.a, () =>
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
    const res = await asTenant(pair.a, () =>
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
    const res = await asTenant(pair.a, () =>
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
    await asTenant(pair.a, () =>
      updateOrderStatusTool({ orderId: orderAId, status: 'confirmed' }),
    );

    const res = await asTenant(pair.a, () =>
      updateOrderStatusTool({ orderId: orderAId, status: 'delivered', deliveryDate: '2028-02-29' }),
    );
    const body = payload(res);

    expect(res.isError).toBeUndefined();
    expect(body.updated).toBe(true);

    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: orderAId } });
    expect(order.deliveryDate?.toISOString().slice(0, 10)).toBe('2028-02-29');
  });
});
