/**
 * Cash held by partners (M3-T09, F-204): money the delivery partners and agents collected on delivered orders and
 * have not deposited yet. Read from AgentBalance (collected less deposited, net of the fees a partner keeps).
 * Simple body on purpose: M5 (F-902) replaces the body only; the name, the arguments and the result shape stay.
 * A point-in-time number, not a range: it carries no date range.
 */
import prisma from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import * as Money from '../../utils/money';
import { getCurrency } from '../../utils/currency';
import { DAY_MS } from './dates';
import { OPEN_COLLECTION_STATUSES } from '../../utils/collectionCash';
import { medianRounded } from './median';
import { kpiMeta, type KpiResult } from './types';

/** The Dashboard's "orders over 8 days" (F-204): cash older than this many days is chased. */
export const CASH_OVERDUE_DAYS = 8;

export async function cashHeldByPartners(tenantId: string): Promise<KpiResult<string>> {
  return runInTenant(tenantId, async () => {
    const now = new Date();
    const overdueBefore = new Date(now.getTime() - CASH_OVERDUE_DAYS * 24 * 60 * 60 * 1000);
    const [currency, held, overdueOrders] = await Promise.all([
      getCurrency(),
      prisma.agentBalance.aggregate({
        where: { currentBalance: { gt: 0 } },
        _sum: { currentBalance: true },
        _count: { _all: true },
      }),
      // The orders behind the cash: per-order AgentCollection rows the partner still holds (draft, verified, approved; a
      // part-paid row stays approved) with a collectionDate older than 8 days. Differs on purpose from agingService, which
      // keeps `deposited` as outstanding until reconciled: here a deposited collection is no longer with the partner.
      prisma.agentCollection.count({
        where: { status: { in: [...OPEN_COLLECTION_STATUSES] }, collectionDate: { lt: overdueBefore }, order: { deletedAt: null } },
      }),
    ]);
    return {
      name: 'Cash held by partners', value: Money.toApi(Money.orZero(held._sum.currentBalance)), unit: 'money', currency,
      ...kpiMeta(now, now, { dateBasis: 'delivery' as const, formulaId: 'cash.heldByPartners.v1' }),
      detail: { partners: held._count._all, overdueOrders },
    };
  });
}

/**
 * Cash received (M3-T20, F-1052): money partners handed in during the range = verified AgentDeposit amounts with a
 * depositDate in [from, to). Same simple-body rule as cashHeldByPartners: M5 (F-902) replaces the body only.
 */
export async function cashReceived(tenantId: string, from: Date, to: Date): Promise<KpiResult<string>> {
  return runInTenant(tenantId, async () => {
    const [currency, received] = await Promise.all([
      getCurrency(),
      prisma.agentDeposit.aggregate({
        where: { status: 'verified', depositDate: { gte: from, lt: to } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    return {
      name: 'Cash received', value: Money.toApi(Money.orZero(received._sum.amount)), unit: 'money', currency,
      ...kpiMeta(from, to, { dateBasis: 'delivery' as const, formulaId: 'cash.received.v1' }),
      detail: { deposits: received._count._all },
    };
  });
}

/** What each partner holds now (AgentBalance, positive balances), by partner id. Same source as cashHeldByPartners. */
export async function cashHeldByPartner(tenantId: string): Promise<Map<number, string>> {
  const rows = await runInTenant(tenantId, () => prisma.agentBalance.findMany({
    where: { currentBalance: { gt: 0 } },
    select: { agentId: true, currentBalance: true },
  }));
  return new Map(rows.map((r) => [r.agentId, Money.toApi(r.currentBalance)]));
}

/**
 * "Pays in" (F-1053): median days from the collection date of an order to the approval of its collection, over the
 * collections dated in [from, to) that are approved. One value per partner id; a partner with no approved collection
 * is absent (the page says "No payout yet"). Simple body on purpose: M5 (F-902) replaces it.
 */
export async function partnerPaysInDays(tenantId: string, from: Date, to: Date): Promise<Map<number, number>> {
  const rows = await runInTenant(tenantId, () => prisma.agentCollection.findMany({
    where: { collectionDate: { gte: from, lt: to }, approvedAt: { not: null } },
    select: { agentId: true, collectionDate: true, approvedAt: true },
  }));
  const gaps = new Map<number, number[]>();
  for (const r of rows) {
    const list = gaps.get(r.agentId) ?? [];
    list.push(Math.max(r.approvedAt!.getTime() - r.collectionDate.getTime(), 0) / DAY_MS);
    gaps.set(r.agentId, list);
  }
  const out = new Map<number, number>();
  for (const [agentId, list] of gaps) out.set(agentId, medianRounded(list, 1) as number);
  return out;
}
