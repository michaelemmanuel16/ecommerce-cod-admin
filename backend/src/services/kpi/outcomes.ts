/**
 * Order breakdowns behind Reports (M3-T20, M3-T21, F-1051, F-1052, F-1053, F-1064). Counts only; every rate goes
 * through rates.ts (closedOutcomeResult, ratePercent) so a number means the same here and on the Dashboard.
 *
 *  - ordersByStatus: orders placed (createdAt) in [from, to), not deleted, per status. Every status is counted, digital
 *    ones included (the rate functions leave those out), so "Where orders ended up" can show them under Other.
 *  - failureReasons: failed_delivery and returned orders placed in the range, per Order.failureReason (null reads as 'unknown').
 *  - successByState: orders placed in the range per delivery state (Order.deliveryState, "Greater Accra (Tema)" grouped as
 *    "Greater Accra"; none reads as 'Not set'), with the delivery success rate of that state (COD-139).
 *  - waitingToDispatch / outForDelivery: right-now snapshots, not tied to a range.
 */
import prisma from '../../utils/prisma';
import { baseState } from '../../utils/regions';
import { runInTenant } from '../../utils/tenantContext';
import { OrderStatus } from '@prisma/client';
import { DAY_MS } from './dates';
import { closedOutcomeResult, DIGITAL, type Rates } from './rates';
import { kpiMeta, type KpiResult } from './types';

export const WAITING: OrderStatus[] = ['confirmed', 'preparing', 'ready_for_pickup'];

export async function ordersByStatus(tenantId: string, from: Date, to: Date): Promise<Map<OrderStatus, number>> {
  const groups = await runInTenant(tenantId, () => prisma.order.groupBy({
    by: ['status'],
    where: { deletedAt: null, createdAt: { gte: from, lt: to } },
    _count: { _all: true },
  }));
  return new Map(groups.map((g) => [g.status, g._count._all]));
}

export async function failureReasons(tenantId: string, from: Date, to: Date): Promise<Array<{ reason: string; count: number }>> {
  const groups = await runInTenant(tenantId, () => prisma.order.groupBy({
    by: ['failureReason'],
    where: { deletedAt: null, status: { in: ['failed_delivery', 'returned'] }, createdAt: { gte: from, lt: to } },
    _count: { _all: true },
  }));
  return groups
    .map((g) => ({ reason: g.failureReason ?? 'unknown', count: g._count._all }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export interface StateRate {
  state: string;
  /** Orders placed in the range for this state, any status. */
  placed: number;
  deliverySuccessRate: Rates['deliverySuccessRate'];
}

export async function successByState(tenantId: string, from: Date, to: Date): Promise<StateRate[]> {
  const meta = kpiMeta(from, to);
  const groups = await runInTenant(tenantId, () => prisma.order.groupBy({
    by: ['deliveryState', 'status'],
    where: { deletedAt: null, status: { notIn: DIGITAL }, createdAt: { gte: from, lt: to } },
    _count: { _all: true },
  }));
  const states = new Map<string, Map<OrderStatus, number>>();
  for (const g of groups) {
    const state = baseState(g.deliveryState) || 'Not set';
    const counts = states.get(state) ?? new Map<OrderStatus, number>();
    counts.set(g.status, (counts.get(g.status) ?? 0) + g._count._all);
    states.set(state, counts);
  }
  return [...states.entries()].map(([state, counts]) => {
    const n = (s: OrderStatus) => counts.get(s) ?? 0;
    return {
      state,
      placed: [...counts.values()].reduce((a, b) => a + b, 0),
      deliverySuccessRate: closedOutcomeResult(
        'Delivery success rate', 'state.deliverySuccess.cohort.v1', 'cohort',
        { delivered: n('delivered'), failed: n('failed_delivery'), returned: n('returned') }, meta,
      ),
    };
  });
}

export interface WaitingToDispatch {
  count: KpiResult<number>;
  /** Whole days the oldest waiting order has waited since it was confirmed (created when never confirmed); null when none wait. */
  oldestDays: number | null;
}

export async function waitingToDispatch(tenantId: string): Promise<WaitingToDispatch> {
  const now = new Date();
  const where = { deletedAt: null, status: { in: WAITING } };
  const [count, oldest] = await runInTenant(tenantId, () => Promise.all([
    prisma.order.count({ where }),
    prisma.order.findFirst({ where, orderBy: [{ confirmedAt: 'asc' }, { createdAt: 'asc' }], select: { confirmedAt: true, createdAt: true } }),
  ]));
  const since = oldest ? (oldest.confirmedAt ?? oldest.createdAt) : null;
  return {
    count: { name: 'Waiting to dispatch', value: count, unit: 'count', ...kpiMeta(now, now, { dateBasis: 'delivery' as const, formulaId: 'orders.waitingToDispatch.v1' }) },
    oldestDays: since ? Math.floor((now.getTime() - since.getTime()) / DAY_MS) : null,
  };
}

/** Orders out for delivery now, in total and per partner id (orders with no partner are in the total only). */
export async function outForDelivery(tenantId: string): Promise<{ total: number; byPartner: Map<number, number> }> {
  const groups = await runInTenant(tenantId, () => prisma.order.groupBy({
    by: ['deliveryAgentId'],
    where: { deletedAt: null, status: 'out_for_delivery' },
    _count: { _all: true },
  }));
  const byPartner = new Map<number, number>();
  let total = 0;
  for (const g of groups) {
    total += g._count._all;
    if (g.deliveryAgentId !== null) byPartner.set(g.deliveryAgentId, g._count._all);
  }
  return { total, byPartner };
}
