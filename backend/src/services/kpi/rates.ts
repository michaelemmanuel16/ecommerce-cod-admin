/**
 * The three named rates (M1-T17, F-251, F-1008). Never "delivery rate".
 *
 * Orders in scope: not deleted, and not digital (`payment_pending`, `payment_failed`, `digital_delivered`
 * have no call and no delivery, F-251 edge case).
 *
 * confirmationRate (F-251) = confirmed / placed, orders placed (createdAt) in [from, to).
 *   confirmed = status confirmed, preparing, ready_for_pickup, out_for_delivery, delivered, failed_delivery,
 *   returned. That is placed - pending_confirmation - cancelled (a confirmed order later cancelled counts as
 *   cancelled). Always by order date, whatever `basis` is. Fixture 1,026 / 1,445 = 71%.
 *
 * deliverySuccessRate (F-251) = delivered / (delivered + failed_delivery + returned), closed orders only.
 *   basis 'cohort':   orders PLACED in the range, outcome by current status. Fixture 376 / 778 = 48%.
 *   basis 'delivery': orders CLOSED in the range: delivered by deliveryDate, returned by returnedAt, failed_delivery
 *                     by its latest `failed_delivery` history row (updatedAt when the order has none).
 *
 * orderToCashYield (F-1008) = delivered / orders placed, over the CLOSED DAY COHORTS in the range. Cohort basis only.
 *   A day cohort (orders placed on one store-zone day) is closed when none of its orders is open
 *   (pending_confirmation, confirmed, preparing, ready_for_pickup, out_for_delivery) or when 30 days have passed
 *   since the end of that day (GUESS in F-1008, CLOSED_COHORT_DAYS). Cancelled orders stay in the denominator.
 *   Null when no cohort is closed. F-251 writes the yield as confirmation x success on the same cohort; F-1008
 *   (the M1-T17 row) writes delivered / placed on closed cohorts. They agree when every order is closed; this
 *   file follows F-1008 and the M1-T17 row. Fixture ~34%.
 *
 * Filters: partnerId = Order.deliveryAgentId. repId = Order.confirmedById for the success rate (F-252: orders
 * the rep confirmed); for the confirmation rate and the yield it is Order.customerRepId (the rep the order is
 * assigned to), because `confirmedById` is empty on an order that was never confirmed, which would drop the
 * denominator. Every result carries dateBasis. Value is a percent rounded half up to 1 decimal, null when the
 * denominator is 0.
 */
import prisma from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import * as Money from '../../utils/money';
import { Prisma, OrderStatus } from '@prisma/client';
import { addDays, endOfDay, getStoreTimeZone } from './dates';
import { kpiMeta, type KpiMeta, type KpiResult } from './types';

type RateBasis = 'cohort' | 'delivery';

interface RateOptions {
  basis?: RateBasis;
  partnerId?: number;
  repId?: number;
}

export interface Rates {
  confirmationRate: KpiResult<number | null>;
  deliverySuccessRate: KpiResult<number | null>;
  orderToCashYield: KpiResult<number | null>;
}

/** Days after the end of the placement day when a cohort counts as closed whatever its orders say (F-1008 GUESS). */
const CLOSED_COHORT_DAYS = 30;

export const DIGITAL: OrderStatus[] = ['payment_pending', 'payment_failed', 'digital_delivered'];
export const CONFIRMED: OrderStatus[] = ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'failed_delivery', 'returned'];
/** Orders with an outcome: the delivery success rate counts these only (F-251). */
export const CLOSED: OrderStatus[] = ['delivered', 'failed_delivery', 'returned'];
export const OPEN: OrderStatus[] = ['pending_confirmation', 'confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery'];

/** Percent to 1 decimal (half up), null when the denominator is 0. */
export function ratePercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Money.roundHalfUp(Money.mul(Money.div(numerator, denominator), 100), 1).toNumber();
}

/**
 * Whole percent for screens that show no decimals: rounded once from the counts, half up. Rounding the 1-decimal rate
 * again gives the wrong whole number at .5 (1,469 of 2,000 is 73.45, stored 73.5, and 73.5 would show as 74 instead of 73).
 */
export function wholeRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Money.roundHalfUp(Money.mul(Money.div(numerator, denominator), 100), 0).toNumber();
}

/** A rate with its counts. */
type CountedRate = KpiResult<number | null> & { detail: Record<string, number> };

/** Confirmation rate (F-251) from its counts. One shape for the range, per-rep and any other cut. */
export function confirmationRateResult(confirmed: number, placed: number, meta: KpiMeta): CountedRate {
  return {
    name: 'Confirmation rate', value: ratePercent(confirmed, placed), unit: 'percent',
    dateBasis: 'createdAt', formulaId: 'rate.confirmation.v1', ...meta,
    detail: { confirmed, placed },
  };
}

/** A success rate over closed orders: delivered / (delivered + failed + returned) (F-251), with its counts. */
export function closedOutcomeResult(
  name: string,
  formulaId: string,
  dateBasis: KpiResult<unknown>['dateBasis'],
  counts: { delivered: number; failed: number; returned: number },
  meta: KpiMeta,
): CountedRate {
  const { delivered, failed, returned } = counts;
  const closed = delivered + failed + returned;
  return {
    name, value: ratePercent(delivered, closed), unit: 'percent', dateBasis, formulaId, ...meta,
    detail: { delivered, failed, returned, closed },
  };
}

export async function rates(tenantId: string, from: Date, to: Date, options: RateOptions = {}): Promise<Rates> {
  const basis: RateBasis = options.basis ?? 'cohort';
  const zone = getStoreTimeZone(tenantId);
  const meta = kpiMeta(from, to);
  const asOf = new Date(meta.asOf);

  return runInTenant(tenantId, async () => {
    const scope: Prisma.OrderWhereInput = {
      deletedAt: null,
      status: { notIn: DIGITAL },
      ...(options.partnerId !== undefined ? { deliveryAgentId: options.partnerId } : {}),
    };
    const placed: Prisma.OrderWhereInput = { ...scope, createdAt: { gte: from, lt: to } };
    const placedForRep: Prisma.OrderWhereInput = options.repId !== undefined ? { ...placed, customerRepId: options.repId } : placed;
    const rep = options.repId !== undefined ? { confirmedById: options.repId } : {};
    const window = { gte: from, lt: to };

    // Orders placed per status, by order date: gives placed and confirmed in one query.
    const placedByStatus = prisma.order.groupBy({ by: ['status'], where: placedForRep, _count: { _all: true } });

    // Delivery success rate. Cohort basis without a rep filter reads the same rows as placedByStatus.
    const outcomes = async (): Promise<{ delivered: number; failed: number; returned: number } | null> => {
      if (basis === 'cohort') {
        if (options.repId === undefined) return null;
        const groups = await prisma.order.groupBy({
          by: ['status'],
          where: { ...placed, ...rep, status: { in: CLOSED } },
          _count: { _all: true },
        });
        const n = (s: OrderStatus) => groups.find((g) => g.status === s)?._count._all ?? 0;
        return { delivered: n('delivered'), failed: n('failed_delivery'), returned: n('returned') };
      }
      const [delivered, returned, failed] = await Promise.all([
        prisma.order.count({ where: { ...scope, ...rep, status: 'delivered', deliveryDate: window } }),
        prisma.order.count({ where: { ...scope, ...rep, status: 'returned', returnedAt: window } }),
        prisma.order.count({
          where: {
            ...scope, ...rep, status: 'failed_delivery',
            OR: [
              { orderHistory: { some: { status: 'failed_delivery', createdAt: window } } },
              { orderHistory: { none: { status: 'failed_delivery' } }, updatedAt: window },
            ],
          },
        }),
      ]);
      return { delivered, failed, returned };
    };

    // Yield on closed day cohorts: one row per store-zone placement day. created_at is a UTC
    // `timestamp without time zone`, so it is tagged UTC first and then moved to the store zone.
    const dayRows = prisma.$queryRaw<Array<{ day: string; total: bigint; delivered: bigint; open: bigint }>>`
      SELECT TO_CHAR((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${zone}, 'YYYY-MM-DD') AS day,
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
             COUNT(*) FILTER (WHERE status::text IN (${Prisma.join(OPEN)})) AS open
      FROM orders
      WHERE tenant_id = ${tenantId}
        AND deleted_at IS NULL
        AND status::text NOT IN (${Prisma.join(DIGITAL)})
        AND created_at >= ${from} AND created_at < ${to}
        ${options.partnerId !== undefined ? Prisma.sql`AND delivery_agent_id = ${options.partnerId}` : Prisma.empty}
        ${options.repId !== undefined ? Prisma.sql`AND customer_rep_id = ${options.repId}` : Prisma.empty}
      GROUP BY 1`;

    const [statusGroups, outcome, dayData] = await Promise.all([placedByStatus, outcomes(), dayRows]);

    const count = (s: OrderStatus) => statusGroups.find((g) => g.status === s)?._count._all ?? 0;
    const placedCount = statusGroups.reduce((sum, g) => sum + g._count._all, 0);
    const confirmedCount = CONFIRMED.reduce((sum, s) => sum + count(s), 0);
    const closedCounts = outcome ?? { delivered: count('delivered'), failed: count('failed_delivery'), returned: count('returned') };

    let yieldDelivered = 0;
    let yieldPlaced = 0;
    let closedDays = 0;
    for (const d of dayData) {
      const isClosed = Number(d.open) === 0 || addDays(endOfDay(d.day, zone), CLOSED_COHORT_DAYS) <= asOf;
      if (!isClosed) continue;
      closedDays += 1;
      yieldDelivered += Number(d.delivered);
      yieldPlaced += Number(d.total);
    }

    return {
      confirmationRate: confirmationRateResult(confirmedCount, placedCount, meta),
      deliverySuccessRate: closedOutcomeResult('Delivery success rate', `rate.deliverySuccess.${basis}.v1`, basis, closedCounts, meta),
      orderToCashYield: {
        name: 'Order-to-cash yield', value: ratePercent(yieldDelivered, yieldPlaced), unit: 'percent',
        dateBasis: 'cohort', formulaId: 'rate.orderToCashYield.v1', ...meta,
        detail: { delivered: yieldDelivered, placed: yieldPlaced, closedDays, totalDays: dayData.length },
      },
    };
  });
}
