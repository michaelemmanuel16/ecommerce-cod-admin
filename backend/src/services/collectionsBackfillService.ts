import { OrderStatus, FeeOutcome, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { runInTenant } from '../utils/tenantContext';
import { OPEN_COLLECTION_STATUSES } from '../utils/collectionCash';
import { GLAutomationService } from './glAutomationService';
import agentReconciliationService from './agentReconciliationService';
import agingService from './agingService';
import { resolveFee } from './feeRuleService';
import { CHARGE_VARIANCE_LIMIT } from './settlementMatching';
import { getSystemUserId } from './systemUserService';
import { getStoreTimeZone, localDate, utcDateOfYmd } from './kpi/dates';
import * as Money from '../utils/money';

/**
 * Backfill for old draft collections, October delivery fees and aging (M5-T30, F-906, F-931, F-936).
 * App data only: no portal export. Three parts, all per tenant, all idempotent:
 *
 * 1. Drafts. A draft collection is reconciled only when the app itself shows its cash was paid: the partner's recorded
 *    deposits (`AgentBalance.totalDeposited`) are larger than what the partner's reconciled and deposited collections add
 *    up to. That surplus pays the oldest delivered drafts first, whole collections only. The cash held was already
 *    reduced by those deposits, so the balance is not touched. Nothing is posted, so no ledger row changes. A draft with
 *    no such cover stays a draft: it is true unpaid cash.
 * 2. October fees. A delivered, failed or returned order from `since` on with no fee gets the fee its partner's rule
 *    gives, the same way the state machine stamps it: `deliveryFee`, source `rule`, DR 5070 / CR 1015 dated the outcome
 *    date, and the open collection (if any) goes down by the fee, like a new collection. A partner with no rule is left
 *    alone (stamping 0 would lock the order before the owner enters the rule).
 * 3. Aging is read live from the open collections (`agingService`), so there is nothing to store; the report prints
 *    the card before and after.
 *
 * August and September ledger rows are never written (D5): `ledgerSnapshot` proves it.
 */

const BATCH = 200;
/** First day a fee is stamped by default: October 2026, the first month with fee rules. */
export const DEFAULT_FEE_SINCE = '2026-10-01';

const FEE_OUTCOME: Partial<Record<OrderStatus, FeeOutcome>> = { delivered: 'delivered', failed_delivery: 'failed', returned: 'returned' };

export interface DraftPlan {
  /** Draft collections now, all orders. */
  drafts: { count: number; amount: Money.Money };
  /** Of those, on a delivered order: the true unpaid cash before any reconcile. */
  delivered: { count: number; amount: Money.Money };
  /** Of those, on an order that is not delivered (cancelled, returned, failed) or was deleted. Left alone. */
  notDelivered: { count: number; amount: Money.Money };
  /** Drafts the recorded deposits pay. */
  reconcile: { collectionId: number; orderId: number; agentId: number; amount: Money.Money }[];
  reconcileAmount: Money.Money;
}

export interface FeeRow {
  orderId: number;
  agentId: number;
  outcome: FeeOutcome;
  fee: Money.Money;
  on: Date;
  historyId: number | null;
}

export interface FeePlan {
  rows: FeeRow[];
  total: Money.Money;
  /** Orders left alone because the partner has no fee rule in force. */
  noRule: number;
  /** Orders with a fee above 0 but no history row to key the ledger entry on. Left alone. */
  noHistory: number;
}

export interface CashHeldRow {
  agentId: number;
  /** Sum of all the partner's collection amounts (already net of the fee stamped at delivery). */
  collected: Money.Money;
  /** Sum of the fees stamped on the partner's orders that have a collection (inside `collected`, shown for information). */
  fees: Money.Money;
  /** AgentBalance.totalDeposited: the recorded deposits. */
  deposits: Money.Money;
  expected: Money.Money;
  held: Money.Money;
  diff: Money.Money;
  withinLimit: boolean;
}

export interface LedgerMonth { month: string; entries: number; lines: number; debit: string; credit: string; maxId: number }

/** Month boundaries are UTC calendar months of `entry_date`. */
export async function ledgerSnapshot(tenantId: string, months: string[] = ['2026-08', '2026-09']): Promise<LedgerMonth[]> {
  const out: LedgerMonth[] = [];
  for (const month of months) {
    const from = new Date(`${month}-01T00:00:00.000Z`);
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
    const rows = await prisma.$queryRaw<{ entries: bigint; lines: bigint; debit: string | null; credit: string | null; max_id: number | null }[]>`
      SELECT COUNT(DISTINCT j.id) AS entries, COUNT(t.id) AS lines,
             COALESCE(SUM(t.debit_amount), 0)::text AS debit, COALESCE(SUM(t.credit_amount), 0)::text AS credit,
             MAX(j.id) AS max_id
      FROM journal_entries j LEFT JOIN account_transactions t ON t.journal_entry_id = j.id
      WHERE j.tenant_id = ${tenantId} AND j.entry_date >= ${from} AND j.entry_date < ${to}`;
    const r = rows[0];
    out.push({ month, entries: Number(r.entries), lines: Number(r.lines), debit: Money.toApi(r.debit ?? 0), credit: Money.toApi(r.credit ?? 0), maxId: r.max_id ?? 0 });
  }
  return out;
}

/** Part 1, read only. */
export async function planDraftReconcile(tenantId: string): Promise<DraftPlan> {
  return runInTenant(tenantId, async () => {
    const drafts = await prisma.agentCollection.findMany({
      where: { status: 'draft' },
      orderBy: [{ collectionDate: 'asc' }, { id: 'asc' }],
      select: { id: true, orderId: true, agentId: true, amount: true, allocatedAmount: true, order: { select: { status: true, deletedAt: true } } },
    });
    const isDelivered = (d: (typeof drafts)[number]) => d.order.status === 'delivered' && d.order.deletedAt === null;
    const delivered = drafts.filter(isDelivered);
    const notDelivered = drafts.filter((d) => !isDelivered(d));
    const tally = (rows: typeof drafts) => ({ count: rows.length, amount: Money.sum(rows.map((d) => Money.sub(d.amount, Money.orZero(d.allocatedAmount)))) });

    // What each partner's recorded deposits cover that no collection shows yet
    const agentIds = [...new Set(delivered.map((d) => d.agentId))];
    const [balances, covered, partial] = await Promise.all([
      prisma.agentBalance.findMany({ where: { agentId: { in: agentIds } }, select: { agentId: true, totalDeposited: true } }),
      prisma.agentCollection.groupBy({ by: ['agentId'], where: { agentId: { in: agentIds }, status: { in: ['reconciled', 'deposited'] } }, _sum: { amount: true } }),
      prisma.agentCollection.groupBy({ by: ['agentId'], where: { agentId: { in: agentIds }, status: { in: [...OPEN_COLLECTION_STATUSES] } }, _sum: { allocatedAmount: true } }),
    ]);
    const credit = new Map<number, Money.Money>();
    for (const id of agentIds) {
      const deposited = Money.orZero(balances.find((b) => b.agentId === id)?.totalDeposited);
      const done = Money.orZero(covered.find((c) => c.agentId === id)?._sum.amount);
      const part = Money.orZero(partial.find((c) => c.agentId === id)?._sum.allocatedAmount);
      credit.set(id, Money.sub(deposited, Money.add(done, part)));
    }

    const reconcile: DraftPlan['reconcile'] = [];
    for (const d of delivered) {
      const left = credit.get(d.agentId) ?? Money.ZERO;
      const owed = Money.sub(d.amount, Money.orZero(d.allocatedAmount));
      if (owed.gt(0) && left.gte(owed)) {
        reconcile.push({ collectionId: d.id, orderId: d.orderId, agentId: d.agentId, amount: owed });
        credit.set(d.agentId, left.minus(owed));
      }
    }
    return {
      drafts: tally(drafts), delivered: tally(delivered), notDelivered: tally(notDelivered),
      reconcile, reconcileAmount: Money.sum(reconcile.map((r) => r.amount)),
    };
  });
}

/** Writes part 1. Each row is claimed from `draft`, so a repeat or a concurrent run changes nothing twice. */
export async function applyDraftReconcile(tenantId: string, plan: DraftPlan): Promise<number> {
  if (plan.reconcile.length === 0) return 0;
  return runInTenant(tenantId, async () => {
    const userId = await getSystemUserId();
    let done = 0;
    for (let i = 0; i < plan.reconcile.length; i += BATCH) {
      const chunk = plan.reconcile.slice(i, i + BATCH);
      done += await prisma.$transaction(async (tx) => {
        const still = await tx.agentCollection.findMany({ where: { id: { in: chunk.map((c) => c.collectionId) }, status: 'draft' }, select: { id: true } });
        const open = new Set(still.map((s) => s.id));
        const items = chunk.filter((c) => open.has(c.collectionId)).map((c) => ({ collectionId: c.collectionId, orderId: c.orderId }));
        await agentReconciliationService.reconcileCollectionRows(tx, items, userId, { onlyFrom: ['draft'] });
        return items.length;
      });
    }
    return done;
  });
}

/** The date an order reached its outcome: delivery date, return time, or the time of its latest failed-delivery history row. */
function outcomeOf(order: { status: OrderStatus; deliveryDate: Date | null; returnedAt: Date | null; updatedAt: Date }, failedAt: Date | undefined): Date | null {
  if (order.status === 'delivered') return order.deliveryDate;
  if (order.status === 'returned') return order.returnedAt;
  return failedAt ?? order.updatedAt;
}

/** Part 2, read only. `since` is YYYY-MM-DD in the store time zone. */
export async function planFeeStamps(tenantId: string, since: string = DEFAULT_FEE_SINCE): Promise<FeePlan> {
  return runInTenant(tenantId, async () => {
    const zone = getStoreTimeZone(tenantId);
    const sinceDay = utcDateOfYmd(since);
    const rows: FeeRow[] = [];
    let noRule = 0;
    let noHistory = 0;
    let after = 0;
    for (;;) {
      const orders = await prisma.order.findMany({
        where: { id: { gt: after }, deletedAt: null, deliveryFee: null, deliveryAgentId: { not: null }, status: { in: ['delivered', 'failed_delivery', 'returned'] } },
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true, status: true, deliveryAgentId: true, totalAmount: true, deliveryDate: true, returnedAt: true, updatedAt: true },
      });
      if (orders.length === 0) break;
      after = orders[orders.length - 1].id;

      const history = await prisma.orderHistory.findMany({
        where: { orderId: { in: orders.map((o) => o.id) }, status: { in: ['delivered', 'failed_delivery', 'returned'] } },
        orderBy: { id: 'asc' },
        select: { id: true, orderId: true, status: true, createdAt: true },
      });
      const latest = new Map<string, { id: number; createdAt: Date }>();
      for (const h of history) latest.set(`${h.orderId}:${h.status}`, { id: h.id, createdAt: h.createdAt });

      for (const o of orders) {
        const outcome = FEE_OUTCOME[o.status]!;
        const h = latest.get(`${o.id}:${o.status}`);
        const on = outcomeOf(o, o.status === 'failed_delivery' ? h?.createdAt : undefined);
        if (!on || utcDateOfYmd(localDate(on, zone)) < sinceDay) continue;
        const resolved = await resolveFee(prisma, o.deliveryAgentId!, outcome, on, o.totalAmount, tenantId);
        if (!resolved.hasRule) { noRule += 1; continue; }
        if (resolved.fee.gt(0) && !h) { noHistory += 1; continue; }
        rows.push({ orderId: o.id, agentId: o.deliveryAgentId!, outcome, fee: resolved.fee, on, historyId: h?.id ?? null });
      }
    }
    return { rows, total: Money.sum(rows.map((r) => r.fee)), noRule, noHistory };
  });
}

/** Writes part 2. An order that has a fee by now (a repeat, or a move since the plan) is skipped. Returns the orders stamped and their fees. */
export async function applyFeeStamps(tenantId: string, plan: FeePlan): Promise<{ stamped: number; total: Money.Money }> {
  if (plan.rows.length === 0) return { stamped: 0, total: Money.ZERO };
  return runInTenant(tenantId, async () => {
    const userId = await getSystemUserId();
    let stamped = 0;
    let total: Money.Money = Money.ZERO;
    for (let i = 0; i < plan.rows.length; i += BATCH) {
      const chunk = plan.rows.slice(i, i + BATCH);
      await prisma.$transaction(async (tx) => {
        for (const r of chunk) {
          const claim = await tx.order.updateMany({ where: { id: r.orderId, deliveryFee: null, deletedAt: null }, data: { deliveryFee: r.fee, deliveryFeeSource: 'rule' } });
          if (claim.count === 0) continue;
          stamped += 1;
          total = total.plus(r.fee);
          if (r.fee.isZero()) continue;
          await GLAutomationService.createDeliveryFeeEntry(tx as any, { id: r.orderId, tenantId }, r.outcome, r.fee, r.historyId!, userId, r.on);
          // The partner keeps the fee from the cash: an open collection is held net of it, like a new one
          const coll = await tx.agentCollection.findFirst({ where: { orderId: r.orderId, status: { in: [...OPEN_COLLECTION_STATUSES] } }, select: { id: true, amount: true } });
          if (!coll) continue;
          const net = Prisma.Decimal.max(Money.sub(coll.amount, r.fee), Money.ZERO);
          const cut = Money.sub(coll.amount, net);
          await tx.agentCollection.update({ where: { id: coll.id }, data: { amount: net } });
          await tx.agentBalance.updateMany({ where: { agentId: r.agentId }, data: { totalCollected: { decrement: cut }, currentBalance: { decrement: cut } } });
        }
      });
    }
    return { stamped, total };
  });
}

/** Cash held per partner against collected minus recorded deposits, within the Finding limit (5% of collected). Read only. */
export async function cashHeldCheck(tenantId: string): Promise<CashHeldRow[]> {
  return runInTenant(tenantId, async () => {
    const [collected, fees, balances] = await Promise.all([
      prisma.agentCollection.groupBy({ by: ['agentId'], _sum: { amount: true } }),
      prisma.order.groupBy({ by: ['deliveryAgentId'], where: { agentCollection: { isNot: null }, deliveryFee: { not: null } }, _sum: { deliveryFee: true } }),
      prisma.agentBalance.findMany({ select: { agentId: true, totalDeposited: true, currentBalance: true } }),
    ]);
    const ids = [...new Set([...collected.map((c) => c.agentId), ...balances.map((b) => b.agentId)])].sort((a, b) => a - b);
    return ids.map((agentId) => {
      const c = Money.orZero(collected.find((x) => x.agentId === agentId)?._sum.amount);
      const b = balances.find((x) => x.agentId === agentId);
      const deposits = Money.orZero(b?.totalDeposited);
      const held = Money.orZero(b?.currentBalance);
      const expected = Money.sub(c, deposits);
      const diff = Money.sub(held, expected);
      return {
        agentId, collected: c, fees: Money.orZero(fees.find((x) => x.deliveryAgentId === agentId)?._sum.deliveryFee), deposits,
        expected, held, diff, withinLimit: diff.abs().lte(Money.mul(c.abs(), CHARGE_VARIANCE_LIMIT)),
      };
    });
  });
}

/** The unpaid-by-age card of the tenant, as the Finance screen shows it. */
export async function agingCard(tenantId: string) {
  return runInTenant(tenantId, () => agingService.getUnpaidByAge());
}
