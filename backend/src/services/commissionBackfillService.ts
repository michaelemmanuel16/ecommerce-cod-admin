import { CommissionKind } from '@prisma/client';
import prisma from '../utils/prisma';
import { runInTenant } from '../utils/tenantContext';
import { GL_ACCOUNTS } from '../config/glAccounts';
import { getSystemUserId } from './systemUserService';
import { BASE_COMMISSION_AMOUNT, UPSELL_COMMISSION_RATE, postEntry } from './commissionService';
import logger from '../utils/logger';
import * as Money from '../utils/money';

/**
 * Backfill of commission entries (F-914, M5-T18, M7-T02).
 * Every delivered order with `commissionPaid = false` that was confirmed by a call rep becomes:
 * - One `earned` entry of kind `base` (GH₵8 or journal amount if previously booked).
 * - One `earned` entry of kind `upsell` (10% of active UpsellLine extra value) if upsell lines exist.
 *
 * Auto-confirmed (customer YES), self-service, no-rep, and AI-agent orders get no entries.
 *
 * Idempotent: an order with live entries is not duplicated. Runs inside the tenant's context.
 * Dry run prints counts and total first; apply is separate.
 */

const BATCH = 200;

export interface BackfillRow {
  orderId: number;
  repId: number;
  kind?: CommissionKind;
  amount: Money.Money;
  earnedAt: Date;
  /** The order's delivery journal entry when it already booked the commission; null means the entry posts its own. */
  adoptJournalEntryId: number | null;
}

export interface BackfillPlan {
  rows: BackfillRow[];
  /** Sum of their amounts. */
  total: Money.Money;
  /** Entries that point at the delivery journal entry (no new posting); the rest of `rows` post their own. */
  adopted: number;
  baseCount: number;
  upsellCount: number;
}

/** Orders that need an entry, with the amount each would get. Reads only. */
export async function planCommissionBackfill(tenantId: string): Promise<BackfillPlan> {
  return runInTenant(tenantId, async () => {
    const rows: BackfillRow[] = [];
    let after = 0;
    for (;;) {
      const orders = await prisma.order.findMany({
        where: {
          id: { gt: after },
          deletedAt: null,
          status: 'delivered',
          commissionPaid: false,
        },
        orderBy: { id: 'asc' },
        take: BATCH,
        select: {
          id: true,
          customerRepId: true,
          confirmedById: true,
          customerResponse: true,
          deliveryDate: true,
          updatedAt: true,
          customerRep: { select: { id: true, commissionAmount: true, kind: true } },
          confirmedBy: { select: { id: true, commissionAmount: true, kind: true } },
          calls: {
            where: { outcome: 'confirmed' },
            orderBy: { id: 'desc' },
            take: 1,
            select: { salesRep: { select: { id: true, commissionAmount: true, kind: true } } },
          },
          upsellLines: {
            where: { status: 'active' },
            select: { extraValue: true },
          },
          commissionEntries: {
            where: { status: { not: 'void' } },
            select: { kind: true },
          },
        },
      });
      if (orders.length === 0) break;
      after = orders[orders.length - 1].id;

      // The delivery journal entry that is live (not voided, not reversed) and its commission line
      const journals = await prisma.journalEntry.findMany({
        where: {
          sourceType: 'order_delivery',
          sourceId: { in: orders.map((o) => o.id) },
          isVoided: false,
          reversingEntryId: null,
        },
        orderBy: { id: 'asc' },
        select: { id: true, sourceId: true, transactions: { where: { account: { code: GL_ACCOUNTS.SALES_REP_COMMISSION } }, select: { debitAmount: true } } },
      });
      const booked = new Map<number, { id: number; amount: Money.Money }>();
      for (const j of journals) {
        const amount = Money.sum(j.transactions.map((t) => t.debitAmount));
        if (j.sourceId != null && amount.gt(0)) booked.set(j.sourceId, { id: j.id, amount });
      }

      for (const order of orders) {
        // Skip auto-confirmed orders (customer YES)
        if (order.customerResponse === 'yes') continue;

        // Rep who confirmed the order: confirming call takes priority (rule P6), then confirmedBy, then customerRep
        const rep = order.calls[0]?.salesRep ?? order.confirmedBy ?? order.customerRep;
        if (!rep || rep.kind !== 'person') continue; // AI agents earn nothing (F-914)

        const earnedAt = order.deliveryDate ?? order.updatedAt;

        // 1. Base entry
        const hasBase = order.commissionEntries.some((e) => e.kind === 'base');
        if (!hasBase) {
          const journal = booked.get(order.id);
          const repAmount = rep.commissionAmount != null ? Money.parse(rep.commissionAmount) : BASE_COMMISSION_AMOUNT;
          const amount = journal ? journal.amount : repAmount;
          if (amount.gt(0)) {
            rows.push({
              orderId: order.id,
              repId: rep.id,
              kind: 'base',
              amount,
              earnedAt,
              adoptJournalEntryId: journal ? journal.id : null,
            });
          }
        }

        // 2. Upsell entry (10% of active UpsellLine extra value)
        const hasUpsell = order.commissionEntries.some((e) => e.kind === 'upsell');
        if (!hasUpsell && order.upsellLines.length > 0) {
          const extraValue = Money.sum(order.upsellLines.map((l) => l.extraValue));
          if (extraValue.gt(0)) {
            const upsellAmount = Money.roundHalfUp(Money.mul(extraValue, UPSELL_COMMISSION_RATE), 2);
            if (upsellAmount.gt(0)) {
              rows.push({
                orderId: order.id,
                repId: rep.id,
                kind: 'upsell',
                amount: upsellAmount,
                earnedAt,
                adoptJournalEntryId: null,
              });
            }
          }
        }
      }
    }
    const adopted = rows.filter((r) => r.adoptJournalEntryId !== null).length;
    const baseCount = rows.filter((r) => (r.kind ?? 'base') === 'base').length;
    const upsellCount = rows.filter((r) => r.kind === 'upsell').length;
    const total = Money.sum(rows.map((r) => r.amount));

    logger.info(`Commission backfill plan: ${rows.length} rows (${baseCount} base, ${upsellCount} upsell), total: ${total.toString()}, adopted: ${adopted}`);
    return { rows, total, adopted, baseCount, upsellCount };
  });
}

/** Writes the plan: one `earned` entry per row, in small transactions. Returns what was written. */
export async function applyCommissionBackfill(tenantId: string, plan: BackfillPlan): Promise<{ written: number; total: Money.Money }> {
  return runInTenant(tenantId, async () => {
    const userId = await getSystemUserId();
    let written = 0;
    let total: Money.Money = Money.ZERO;
    for (let i = 0; i < plan.rows.length; i += BATCH) {
      const chunk = plan.rows.slice(i, i + BATCH);
      await prisma.$transaction(async (tx) => {
        // A repeat or a concurrent run: orders that already have an entry of this kind are skipped
        const have = await tx.commissionEntry.findMany({
          where: { orderId: { in: chunk.map((r) => r.orderId) }, status: { not: 'void' } },
          select: { orderId: true, kind: true },
        });
        const skip = new Set(have.map((e) => `${e.orderId}:${e.kind}`));
        const fresh = chunk.filter((r) => !skip.has(`${r.orderId}:${r.kind ?? 'base'}`));
        const entry = (r: BackfillRow) => ({
          tenantId,
          orderId: r.orderId,
          userId: r.repId,
          kind: r.kind ?? ('base' as const),
          status: 'earned' as const,
          amount: r.amount,
          earnedAt: r.earnedAt,
          note: r.kind === 'upsell' ? 'Backfilled upsell commission (M7)' : 'Backfilled from the order (M5)',
        });

        // Entries that keep the delivery journal entry need no posting: one insert
        await tx.commissionEntry.createMany({
          data: fresh.filter((r) => r.adoptJournalEntryId !== null).map((r) => ({ ...entry(r), journalEntryId: r.adoptJournalEntryId })),
        });
        // The rest post their own journal entry, so each needs its id
        for (const row of fresh.filter((r) => r.adoptJournalEntryId === null)) {
          const created = await tx.commissionEntry.create({ data: entry(row) });
          await postEntry(tx, created.id, userId);
        }
        written += fresh.length;
        total = total.plus(Money.sum(fresh.map((r) => r.amount)));
      }, { timeout: 60_000 });
    }
    return { written, total };
  });
}

/** Account 2020 against the open entries: the two numbers the health check compares (F-914). */
export async function commissionLedgerCheck(tenantId: string): Promise<{ payableBalance: Money.Money; openEntries: Money.Money; difference: Money.Money }> {
  return runInTenant(tenantId, async () => {
    const [account, open] = await Promise.all([
      prisma.account.findFirst({ where: { code: GL_ACCOUNTS.COMMISSIONS_PAYABLE }, select: { currentBalance: true } }),
      prisma.commissionEntry.aggregate({ where: { status: 'earned', payoutId: null }, _sum: { amount: true } }),
    ]);
    const payableBalance = Money.orZero(account?.currentBalance);
    const openEntries = Money.orZero(open._sum.amount);
    return { payableBalance, openEntries, difference: payableBalance.minus(openEntries) };
  });
}
