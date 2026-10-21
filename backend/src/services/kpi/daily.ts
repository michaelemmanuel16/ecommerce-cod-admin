/**
 * Day-level counts behind the Dashboard quests and the orders tile (M3-T09, F-203, F-204).
 *
 *  - ordersPlacedByDay: orders placed (createdAt) per store-zone day, in [from, to). Same scope as the confirmation
 *    rate: not deleted, not digital (rates.ts). Days with no order are absent.
 *  - failedDeliveryCalls: calls logged in [from, to) on orders whose status is `failed_delivery`, counted once per order
 *    (F-203: an order with several calls counts once).
 *  - failedDeliveryCallsTarget: the daily call-rep target. A `daily` Target with metric `failed_delivery_calls_per_day`
 *    that covers the day (newest first); 15 when none is set (GUESS from the mockup, F-203; the owner sets it in Targets, M6).
 */
import prisma from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { Prisma } from '@prisma/client';
import { getStoreTimeZone, parseYmd } from './dates';
import { DIGITAL } from './rates';
import { kpiMeta, type KpiResult } from './types';

export const FAILED_CALLS_METRIC = 'failed_delivery_calls_per_day';
export const DEFAULT_FAILED_CALLS_TARGET = 15;

export interface OrdersPlacedDay {
  /** Store-zone day, YYYY-MM-DD. */
  date: string;
  count: number;
}

export async function ordersPlacedByDay(tenantId: string, from: Date, to: Date): Promise<OrdersPlacedDay[]> {
  const zone = getStoreTimeZone(tenantId);
  const rows = await runInTenant(tenantId, () => prisma.$queryRaw<Array<{ day: string; total: bigint }>>`
    SELECT TO_CHAR((created_at AT TIME ZONE 'UTC') AT TIME ZONE ${zone}, 'YYYY-MM-DD') AS day, COUNT(*) AS total
    FROM orders
    WHERE tenant_id = ${tenantId}
      AND deleted_at IS NULL
      AND status::text NOT IN (${Prisma.join(DIGITAL)})
      AND created_at >= ${from} AND created_at < ${to}
    GROUP BY 1
    ORDER BY 1`);
  return rows.map((r) => ({ date: r.day, count: Number(r.total) }));
}

export async function failedDeliveryCalls(tenantId: string, from: Date, to: Date): Promise<KpiResult<number>> {
  const orders = await runInTenant(tenantId, () => prisma.call.groupBy({
    by: ['orderId'],
    where: { createdAt: { gte: from, lt: to }, order: { status: 'failed_delivery', deletedAt: null } },
  }));
  return {
    name: 'Failed delivery calls', value: orders.length, unit: 'count',
    ...kpiMeta(from, to, { dateBasis: 'createdAt' as const, formulaId: 'calls.failedDelivery.v1' }),
  };
}

export async function failedDeliveryCallsTarget(tenantId: string, asOfDate: string): Promise<{ value: number; source: 'target' | 'default' }> {
  const { year, month, day } = parseYmd(asOfDate);
  const asOfDay = new Date(Date.UTC(year, month - 1, day));
  const row = await runInTenant(tenantId, () => prisma.target.findFirst({
    where: { scope: 'daily', metric: FAILED_CALLS_METRIC, userId: null, periodStart: { lte: asOfDay }, periodEnd: { gte: asOfDay } },
    orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
  }));
  return row ? { value: Number(row.value), source: 'target' } : { value: DEFAULT_FAILED_CALLS_TARGET, source: 'default' };
}
