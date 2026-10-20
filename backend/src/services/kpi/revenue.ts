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
import { Prisma } from '@prisma/client';
import { getStoreTimeZone } from './dates';

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

export interface RevenueDay {
  /** Store-zone day, YYYY-MM-DD. */
  date: string;
  /** Delivered revenue booked on that day (money string, can be negative on a day with more returns than deliveries). */
  revenue: string;
  deliveredOrders: number;
}

export interface RevenueArea {
  /** Delivery area of the order, null when the order has none. */
  area: string | null;
  revenue: string;
  deliveredOrders: number;
}

interface SignedRevenueRow {
  day: string;
  area: string | null;
  repId: number | null;
  amount: string;
  orders: number;
}

/**
 * Every delivered-revenue movement in [from, to) as signed rows, grouped by store-zone day, delivery area and rep in one
 * query. Same rules as deliveredRevenue: delivered and paid digital orders at deliveryDate (updatedAt when null);
 * a returned order that has a `delivered` history row adds at the booked time and subtracts at returnedAt.
 * orders.* timestamps are UTC `timestamp without time zone`, so they are tagged UTC first and then moved to the zone.
 */
async function signedRevenueRows(tenantId: string, from: Date, to: Date, scope: RevenueScope): Promise<SignedRevenueRow[]> {
  const zone = getStoreTimeZone(tenantId);
  const rep = scope.customerRepId !== undefined ? Prisma.sql`AND o.customer_rep_id = ${scope.customerRepId}` : Prisma.empty;
  const agent = scope.deliveryAgentId !== undefined ? Prisma.sql`AND o.delivery_agent_id = ${scope.deliveryAgentId}` : Prisma.empty;
  return runInTenant(tenantId, () => prisma.$queryRaw<SignedRevenueRow[]>`
    WITH moves AS (
      SELECT COALESCE(o.delivery_date, o.updated_at) AS at, o.delivery_area AS area, o.customer_rep_id AS rep_id, o.total_amount AS amount, 1 AS orders
      FROM orders o
      WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NULL ${rep} ${agent}
        AND COALESCE(o.delivery_date, o.updated_at) >= ${from} AND COALESCE(o.delivery_date, o.updated_at) < ${to}
        AND (o.status::text = 'delivered'
             OR (o.status::text = 'digital_delivered' AND o.payment_status::text = 'paid' AND o.total_amount > 0))
      UNION ALL
      SELECT b.booked_at, o.delivery_area, o.customer_rep_id, o.total_amount, 1
      FROM orders o
      JOIN LATERAL (SELECT MAX(h.created_at) AS booked_at FROM order_history h WHERE h.order_id = o.id AND h.status::text = 'delivered') b
        ON b.booked_at IS NOT NULL
      WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NULL ${rep} ${agent} AND o.status::text = 'returned'
        AND b.booked_at >= ${from} AND b.booked_at < ${to}
      UNION ALL
      SELECT o.returned_at, o.delivery_area, o.customer_rep_id, -o.total_amount, -1
      FROM orders o
      JOIN LATERAL (SELECT MAX(h.created_at) AS booked_at FROM order_history h WHERE h.order_id = o.id AND h.status::text = 'delivered') b
        ON b.booked_at IS NOT NULL
      WHERE o.tenant_id = ${tenantId} AND o.deleted_at IS NULL ${rep} ${agent} AND o.status::text = 'returned'
        AND o.returned_at >= ${from} AND o.returned_at < ${to}
    )
    SELECT TO_CHAR((at AT TIME ZONE 'UTC') AT TIME ZONE ${zone}, 'YYYY-MM-DD') AS day,
           area, rep_id AS "repId", SUM(amount)::text AS amount, SUM(orders)::int AS orders
    FROM moves
    GROUP BY 1, 2, 3`);
}

/** Sum signed rows into one bucket per key, in the order keys first appear. */
function groupRows<K>(rows: SignedRevenueRow[], keyOf: (row: SignedRevenueRow) => K) {
  const groups = new Map<K, { revenue: Money.Money; orders: number }>();
  for (const r of rows) {
    const key = keyOf(r);
    const g = groups.get(key) ?? { revenue: Money.ZERO, orders: 0 };
    groups.set(key, { revenue: Money.add(g.revenue, r.amount), orders: g.orders + r.orders });
  }
  return groups;
}

/**
 * Delivered revenue per store-zone day, oldest first (only days with a movement). The days add up to
 * deliveredRevenue(...).total.value for the same range and scope.
 */
export async function deliveredRevenueByDay(
  tenantId: string,
  from: Date,
  to: Date,
  scope: RevenueScope = {},
): Promise<RevenueDay[]> {
  const rows = await signedRevenueRows(tenantId, from, to, scope);
  return [...groupRows(rows, (r) => r.day).entries()]
    .map(([date, d]) => ({ date, revenue: Money.toApi(d.revenue), deliveredOrders: d.orders }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Delivered revenue per delivery area, most revenue first. Same rules and total as deliveredRevenueByDay. */
export async function deliveredRevenueByArea(
  tenantId: string,
  from: Date,
  to: Date,
  scope: RevenueScope = {},
): Promise<RevenueArea[]> {
  const rows = await signedRevenueRows(tenantId, from, to, scope);
  return [...groupRows(rows, (r) => r.area).entries()]
    .map(([area, a]) => ({ area, revenue: Money.toApi(a.revenue), deliveredOrders: a.orders, value: a.revenue }))
    .sort((a, b) => Money.compare(b.value, a.value))
    .map(({ value: _value, ...rest }) => rest);
}

/**
 * Delivered revenue per sales rep (Order.customerRepId), same rules and total as deliveredRevenue. Reps with no
 * movement in the range are absent. Orders with no rep are left out.
 */
export async function deliveredRevenueByRep(
  tenantId: string,
  from: Date,
  to: Date,
  scope: RevenueScope = {},
): Promise<Map<number, { revenue: string; deliveredOrders: number }>> {
  const rows = (await signedRevenueRows(tenantId, from, to, scope)).filter((r) => r.repId !== null);
  const byRep = new Map<number, { revenue: string; deliveredOrders: number }>();
  for (const [repId, g] of groupRows(rows, (r) => r.repId as number)) {
    byRep.set(repId, { revenue: Money.toApi(g.revenue), deliveredOrders: g.orders });
  }
  return byRep;
}
