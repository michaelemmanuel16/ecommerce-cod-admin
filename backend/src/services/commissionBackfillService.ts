import prisma from '../utils/prisma';
import { runInTenant } from '../utils/tenantContext';
import { GL_ACCOUNTS } from '../config/glAccounts';
import { getSystemUserId } from './systemUserService';
import { postEntry } from './commissionService';
import * as Money from '../utils/money';

/**
 * Backfill of commission entries (F-914, M5-T18). Every delivered order with `commissionPaid = false` and a
 * confirming rep who has a rate becomes one `earned` entry of kind `base`.
 *
 * Amount and ledger: the delivery journal entry of an old order already booked DR 5050, CR 2020 for the rep's
 * commission. When it did, the entry takes that amount and points at that journal entry, so nothing posts twice
 * and 2020 stays right. When the order has no such line (the rate was 0 then), the entry takes the rep's current
 * rate and posts DR 5050, CR 2020 itself, dated the delivery date.
 *
 * Idempotent: an order with a live `base` entry is never read again. Runs inside the tenant's context.
 * `dryRun` counts and writes nothing.
 */

const BATCH = 200;

export interface BackfillRow {
  orderId: number;
  repId: number;
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
          customerRepId: { not: null },
          commissionEntries: { none: { kind: 'base', status: { not: 'void' } } },
        },
        orderBy: { id: 'asc' },
        take: BATCH,
        select: {
          id: true,
          customerRepId: true,
          deliveryDate: true,
          updatedAt: true,
          customerRep: { select: { commissionAmount: true, kind: true } },
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
        const rep = order.customerRep;
        if (!rep || rep.kind !== 'person') continue; // AI agents earn nothing (F-914)
        const journal = booked.get(order.id);
        const amount = journal ? journal.amount : Money.orZero(rep.commissionAmount);
        if (!amount.gt(0)) continue;
        rows.push({
          orderId: order.id,
          repId: order.customerRepId as number,
          amount,
          earnedAt: order.deliveryDate ?? order.updatedAt,
          adoptJournalEntryId: journal ? journal.id : null,
        });
      }
    }
    const adopted = rows.filter((r) => r.adoptJournalEntryId !== null).length;
    return { rows, total: Money.sum(rows.map((r) => r.amount)), adopted };
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
        // A repeat or a concurrent run: orders that already have a live base entry are skipped
        const have = await tx.commissionEntry.findMany({
          where: { orderId: { in: chunk.map((r) => r.orderId) }, kind: 'base', status: { not: 'void' } },
          select: { orderId: true },
        });
        const skip = new Set(have.map((e) => e.orderId));
        const fresh = chunk.filter((r) => !skip.has(r.orderId));
        const entry = (r: BackfillRow) => ({
          tenantId, orderId: r.orderId, userId: r.repId, kind: 'base' as const, status: 'earned' as const,
          amount: r.amount, earnedAt: r.earnedAt, note: 'Backfilled from the order (M5)',
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
