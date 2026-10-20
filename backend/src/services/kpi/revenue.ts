/**
 * Delivered revenue (M1-T16). The one revenue definition (F-250, F-900, F-901).
 *
 * Revenue of a range [from, to) =
 *   physical: sum of totalAmount of orders with status `delivered` and deliveryDate in the range
 *   digital:  sum of totalAmount of orders with status `digital_delivered`, paymentStatus `paid`, totalAmount > 0,
 *             and deliveryDate (payment time) in the range (F-901). A free bundled digital item sits inside a
 *             physical order's totalAmount at 0, so it adds 0 and is never counted twice.
 *   Cancelled, failed_delivery and every open status add nothing.
 *
 * Returns (F-900 acceptance criterion 4, F-250 "ledger reversal"): an order delivered and later returned is
 * booked in its delivery month and leaves in the month of its RETURN only. Closed months are not restated.
 * The state machine clears Order.deliveryDate on delivered -> returned, so the booked delivery time of a
 * returned order is read from its OrderHistory row `status = delivered` (latest). So:
 *   + totalAmount of returned orders whose delivered history row falls in the range (still booked)
 *   - totalAmount of returned orders whose returnedAt falls in the range (leaves now)
 * Returned orders with no `delivered` history row never delivered (failed attempt, then returned) and add 0.
 * This matches the ledger (return entry dated returnedAt, F-905). It differs from F-250's edge-case line
 * "revenue leaves the delivery day"; F-900 and the M1-T16 row both say return month, so that wins.
 * Limit: a backdated delivery (MCP deliveryDate option) of an order that is later returned is booked at the
 * time of the history row, not the backdated date, because the backdated date is cleared on return.
 *
 * Old rows: `delivered` or paid `digital_delivered` with a null deliveryDate use updatedAt (F-900 edge case).
 */
import prisma from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import * as Money from '../../utils/money';
import type { KpiResult } from './types';
import { getCurrency } from '../../utils/currency';

export interface DeliveredRevenue {
  physical: KpiResult<string>;
  digital: KpiResult<string>;
  total: KpiResult<string>;
  /** Delivered orders counted in the range: delivered + paid digital, adjusted for returns the same way as money. */
  deliveredOrders: KpiResult<number>;
}

const FORMULA_ID = 'revenue.delivered.v1';

function inRange(d: Date | null | undefined, from: Date, to: Date): boolean {
  return !!d && d >= from && d < to;
}

/** Limits revenue to one rep's or one partner's orders (role scope for sales reps and delivery agents). */
export interface RevenueScope {
  customerRepId?: number;
  deliveryAgentId?: number;
}

export async function deliveredRevenue(
  tenantId: string,
  from: Date,
  to: Date,
  scope: RevenueScope = {},
): Promise<DeliveredRevenue> {
  return runInTenant(tenantId, async () => {
    const dateWindow = {
      OR: [
        { deliveryDate: { gte: from, lt: to } },
        { deliveryDate: null, updatedAt: { gte: from, lt: to } },
      ],
    };
    const base = { deletedAt: null, ...scope, ...dateWindow };

    const [currency, physicalAgg, digitalAgg, returned] = await Promise.all([
      getCurrency(),
      prisma.order.aggregate({
        where: { ...base, status: 'delivered' },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      prisma.order.aggregate({
        where: { ...base, status: 'digital_delivered', paymentStatus: 'paid', totalAmount: { gt: 0 } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      prisma.order.findMany({
        where: {
          deletedAt: null,
          ...scope,
          status: 'returned',
          orderHistory: { some: { status: 'delivered' } },
          OR: [
            { returnedAt: { gte: from, lt: to } },
            { orderHistory: { some: { status: 'delivered', createdAt: { gte: from, lt: to } } } },
          ],
        },
        select: {
          totalAmount: true,
          returnedAt: true,
          orderHistory: { where: { status: 'delivered' }, orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
        },
      }),
    ]);

    let physical = Money.orZero(physicalAgg._sum.totalAmount);
    let deliveredCount = physicalAgg._count._all;
    for (const order of returned) {
      const bookedAt = order.orderHistory[0]?.createdAt;
      if (inRange(bookedAt, from, to)) {
        physical = Money.add(physical, order.totalAmount);
        deliveredCount += 1;
      }
      if (inRange(order.returnedAt, from, to)) {
        physical = Money.sub(physical, order.totalAmount);
        deliveredCount -= 1;
      }
    }
    const digital = Money.orZero(digitalAgg._sum.totalAmount);
    deliveredCount += digitalAgg._count._all;

    const meta = {
      dateBasis: 'deliveryDate' as const,
      formulaId: FORMULA_ID,
      from: from.toISOString(),
      to: to.toISOString(),
      asOf: new Date().toISOString(),
    };
    return {
      physical: { name: 'Delivered revenue, physical', value: Money.toApi(physical), unit: 'money', currency, ...meta },
      digital: { name: 'Delivered revenue, digital', value: Money.toApi(digital), unit: 'money', currency, ...meta },
      total: { name: 'Delivered revenue', value: Money.toApi(Money.add(physical, digital)), unit: 'money', currency, ...meta },
      deliveredOrders: { name: 'Delivered orders', value: deliveredCount, unit: 'count', ...meta },
    };
  });
}
