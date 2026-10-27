import { CommissionKind, PayoutKind, Prisma } from '@prisma/client';
import { resolveTenantId } from '../utils/tenantContext';
import { currencyOfTenant } from '../utils/currency';
import { withSoftDeleted } from '../utils/prismaExtensions';
import prisma, { TransactionClient } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { GLAutomationService } from './glAutomationService';
import * as Money from '../utils/money';
import { getStoreTimeZone, localDate, MONTH_RE, monthRange } from './kpi/dates';

/**
 * One payout service for money out to people (F-913, F-1164, M5-T19).
 *
 * A payout pays one person from their open `earned` CommissionEntry rows. A rep is paid commission, upsell reward and
 * target reward. A delivery agent is paid target rewards only. A delivery fee is never paid here: the partner keeps it
 * from the cash it collects (decision F4), so the input has no fee field and the request body is strict.
 *
 * Save marks the paid entries `paid` and links them to one `Payout`, then posts DR 2020 Commissions payable,
 * CR 1010 Cash at bank and MoMo. Method, reference and recorder are stored on the payout.
 */

const CURRENCY_SIGN: Record<string, string> = { GHS: 'GH₵', NGN: '₦' };

interface OpenEntry {
  id: number;
  amount: Money.Money;
  earnedAt: Date | null;
}

interface Allocation {
  entryId: number;
  /** What this payout pays on the entry. */
  pay: Money.Money;
  /** What stays earned on the entry (a split leaves it above 0). */
  remainder: Money.Money;
}

/**
 * Pays the oldest entries first. Whole entries until the amount runs out; the last one may be split (the part paid
 * and the remainder that stays earned). Entries with no `earnedAt` count as oldest. Throws when the amount is above what the
 * entries hold: callers check that first for a clear message.
 */
export function allocateOldestFirst(entries: OpenEntry[], amount: Money.Money): Allocation[] {
  const sorted = [...entries].sort((a, b) => (a.earnedAt?.getTime() ?? 0) - (b.earnedAt?.getTime() ?? 0) || a.id - b.id);
  const out: Allocation[] = [];
  let left = amount;
  for (const e of sorted) {
    if (left.lte(0)) break;
    const pay = e.amount.lt(left) ? e.amount : left;
    out.push({ entryId: e.id, pay, remainder: e.amount.minus(pay) });
    left = left.minus(pay);
  }
  if (left.gt(0)) throw new RangeError('Amount is above what the entries hold');
  return out;
}

interface SummaryRow {
  kind: CommissionKind;
  status: string;
  amount: Money.MoneyInput;
  /** An `earned` entry never has a payout (paying it makes it `paid`); a row read without the link counts as open. */
  payoutId?: number | null;
}

export interface Summary {
  /** Per kind: commission (base), upsell reward, target reward. */
  base: Money.Money;
  upsell: Money.Money;
  reward: Money.Money;
  earned: Money.Money;
  paid: Money.Money;
  /** The one owed rule: `earned` and not yet on a payout. The form, the tab and the payout check all read this. */
  owed: Money.Money;
}

/** Earned, paid and owed of a set of entries (only `earned` and `paid` entries count). One reducer for every screen. */
export function summarize(rows: Iterable<SummaryRow>): Summary {
  const t = { base: Money.ZERO, upsell: Money.ZERO, reward: Money.ZERO, earned: Money.ZERO, paid: Money.ZERO, owed: Money.ZERO };
  for (const r of rows) {
    if (r.status !== 'earned' && r.status !== 'paid') continue;
    const amount = Money.parse(r.amount);
    t[r.kind] = t[r.kind].plus(amount);
    t.earned = t.earned.plus(amount);
    if (r.status === 'paid') t.paid = t.paid.plus(amount);
    else if (!r.payoutId) t.owed = t.owed.plus(amount);
  }
  return t;
}

/** What the lock query returns for an entry. */
interface LockedEntry extends OpenEntry {
  userId: number;
  tenantId: string;
  orderId: number | null;
  kind: CommissionKind;
  status: string;
  payoutId: number | null;
  journalEntryId: number | null;
}

export interface RecordPayoutInput {
  payeeId: number;
  /** Defaults to what the ticked (or all open) entries hold. */
  amount?: Money.MoneyInput;
  method: string;
  reference?: string | null;
  payoutDate?: Date;
  notes?: string | null;
  /** The entries to pay. Left out = every open entry of the payee, oldest first. */
  entryIds?: number[];
}

class PayoutService {
  /** The payee, and the kind of payout they get. AI agents and companies get none. */
  private async loadPayee(tx: TransactionClient | typeof prisma, payeeId: number) {
    // Soft delete skipped: a person who left (inactive) can still be owed, and paid
    const payee = await withSoftDeleted(() => tx.user.findFirst({
      where: { id: payeeId },
      select: { id: true, tenantId: true, firstName: true, lastName: true, role: true, kind: true },
    }));
    if (!payee) throw new AppError('Person not found', 404);
    if (payee.kind === 'ai_agent') throw new AppError('No payout for AI agents', 400);
    if (payee.kind !== 'person') throw new AppError('Only people are paid through a payout', 400);
    const kind: PayoutKind = payee.role === 'delivery_agent' ? 'agent' : 'rep';
    return { ...payee, payoutKind: kind };
  }

  /** The preview of the form: what the person earned, what was paid, what is owed, and the open entries to tick. */
  async getOwed(payeeId: number) {
    const payee = await this.loadPayee(prisma, payeeId);
    const rows = await prisma.commissionEntry.findMany({
      where: { userId: payeeId, status: { in: ['earned', 'paid'] }, ...(payee.payoutKind === 'agent' ? { kind: 'reward' } : {}) },
      orderBy: [{ earnedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, orderId: true, kind: true, status: true, amount: true, earnedAt: true, payoutId: true },
    });
    const total = summarize(rows);
    const entries = rows
      .filter((r) => r.status === 'earned' && r.payoutId === null)
      .map((r) => ({ id: r.id, orderId: r.orderId, kind: r.kind, amount: r.amount, earnedAt: r.earnedAt }));
    return {
      payee: { id: payee.id, firstName: payee.firstName, lastName: payee.lastName, kind: payee.payoutKind },
      commission: total.base,
      upsellReward: total.upsell,
      targetReward: total.reward,
      earned: total.earned,
      paid: total.paid,
      owed: total.owed,
      entries,
    };
  }

  /**
   * The Rep commissions tab (F-914): one row per rep with what was earned, paid and is owed, and what was paid in `month`
   * (YYYY-MM, this month by default). Reps with no entry yet still show (owed 0). Inactive reps show only while they are
   * still owed something, unless `includeInactive`. Delivery agents and companies are not listed. `totals` add up the rows.
   */
  async listOwed(opts: { month?: string; includeInactive?: boolean } = {}) {
    const zone = getStoreTimeZone(resolveTenantId());
    const month = opts.month ?? localDate(new Date(), zone).slice(0, 7);
    if (!MONTH_RE.test(month)) throw new AppError('Month must be written YYYY-MM', 400, 'VALIDATION_ERROR');
    const [year, mon] = month.split('-').map(Number);
    const { from, to } = monthRange(year, mon, zone);

    const candidates = await withSoftDeleted(() => prisma.user.findMany({
      where: { kind: 'person', role: { not: 'delivery_agent' }, OR: [{ role: 'sales_rep' }, { commissionEntries: { some: { status: { in: ['earned', 'paid'] } } } }] },
      select: { id: true, firstName: true, lastName: true, isActive: true },
      orderBy: [{ firstName: 'asc' }, { id: 'asc' }],
    }));
    const ids = candidates.map((c) => c.id);
    const [sums, lastPaid, inMonth] = await Promise.all([
      prisma.commissionEntry.groupBy({
        by: ['userId', 'kind', 'status'],
        where: { userId: { in: ids }, status: { in: ['earned', 'paid'] } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.payout.groupBy({ by: ['payeeId'], where: { payeeId: { in: ids }, kind: 'rep' }, _max: { payoutDate: true } }),
      prisma.payout.groupBy({ by: ['payeeId'], where: { payeeId: { in: ids }, kind: 'rep', payoutDate: { gte: from, lt: to } }, _sum: { amount: true } }),
    ]);
    // Bucket the grouped rows once, by rep
    const byRep = new Map<number, typeof sums>();
    for (const row of sums) byRep.set(row.userId, [...(byRep.get(row.userId) ?? []), row]);
    const last = new Map(lastPaid.map((p) => [p.payeeId, p._max.payoutDate]));
    const paidIn = new Map(inMonth.map((p) => [p.payeeId, Money.orZero(p._sum.amount)]));

    const reps = candidates
      .map(({ isActive, ...rep }) => {
        const mine = byRep.get(rep.id) ?? [];
        const total = summarize(mine.map((r) => ({ kind: r.kind, status: r.status, amount: r._sum.amount ?? Money.ZERO })));
        return {
          active: isActive,
          row: {
            ...rep,
            delivered: mine.filter((r) => r.kind === 'base').reduce((n, r) => n + r._count._all, 0),
            commission: total.base,
            upsellReward: total.upsell,
            targetReward: total.reward,
            earned: total.earned,
            paid: total.paid,
            owed: total.owed,
            paidInMonth: paidIn.get(rep.id) ?? Money.ZERO,
            lastPayout: last.get(rep.id) ?? null,
          },
        };
      })
      .filter((r) => opts.includeInactive || r.active || r.row.owed.gt(0))
      .map((r) => r.row);

    return {
      month,
      reps,
      totals: {
        owed: Money.sum(reps.map((r) => r.owed)),
        paid: Money.sum(reps.map((r) => r.paid)),
        paidInMonth: Money.sum(reps.map((r) => r.paidInMonth)),
        repsOwed: reps.filter((r) => r.owed.gt(0)).length,
      },
    };
  }

  /**
   * How many reps are owed something: the `totals.repsOwed` of `listOwed`, from one group by instead of the whole table
   * (the count pill of the Rep commissions tab). A rep is owed when the `earned` entries not on a payout add up above 0.
   */
  async countRepsOwed(): Promise<number> {
    const owed = await withSoftDeleted(() => prisma.commissionEntry.groupBy({
      by: ['userId'],
      where: { status: 'earned', payoutId: null, user: { kind: 'person', role: { not: 'delivery_agent' } } },
      having: { amount: { _sum: { gt: 0 } } },
    }));
    return owed.length;
  }

  /** Payout history: one list for Finance and Staff. */
  async list(filter: { payeeId?: number; kind?: PayoutKind; page?: number; limit?: number }) {
    const page = Math.max(1, filter.page ?? 1);
    const limit = Math.min(200, Math.max(1, filter.limit ?? 50));
    const where: Prisma.PayoutWhereInput = {
      ...(filter.payeeId ? { payeeId: filter.payeeId } : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.payout.findMany({
        where,
        orderBy: [{ payoutDate: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          payee: { select: { id: true, firstName: true, lastName: true, role: true } },
          recordedBy: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { commissionEntries: true } },
        },
      }),
      prisma.payout.count({ where }),
    ]);
    return { payouts: rows, total, page, limit };
  }

  /** Records one payout. See the file header. */
  async record(input: RecordPayoutInput, recordedById: number) {
    try {
      return await prisma.$transaction(async (tx) => {
        const payee = await this.loadPayee(tx, input.payeeId);
        const method = input.method.trim();
        const reference = input.reference?.trim() || null;
        const rewardOnly = payee.payoutKind === 'agent';

        if (reference) {
          const used = await tx.payout.findFirst({ where: { payeeId: payee.id, method, reference }, select: { id: true } });
          if (used) throw new AppError('This reference was already used for this person and method', 409);
        }

        // One query locks the entries and returns them: two payouts on the same entries take turns, and the second finds them paid.
        const ids = input.entryIds && input.entryIds.length > 0 ? [...new Set(input.entryIds)] : null;
        const idFilter = ids ? Prisma.sql`id = ANY(${ids}::int[])` : Prisma.sql`user_id = ${payee.id} AND status = 'earned' AND payout_id IS NULL ${rewardOnly ? Prisma.sql`AND kind = 'reward'` : Prisma.empty}`;
        const locked = await tx.$queryRaw<LockedEntry[]>`
          SELECT id, user_id AS "userId", tenant_id AS "tenantId", order_id AS "orderId", kind, status, amount,
                 earned_at AS "earnedAt", payout_id AS "payoutId", journal_entry_id AS "journalEntryId"
          FROM commission_entries
          WHERE tenant_id = ${resolveTenantId()} AND ${idFilter}
          ORDER BY id FOR UPDATE`;
        if (ids && locked.length !== ids.length) throw new AppError('An entry is not this person\'s', 400);
        for (const entry of locked) {
          if (entry.userId !== payee.id) throw new AppError('An entry is not this person\'s', 400);
          if (entry.status === 'paid' || entry.payoutId !== null) throw new AppError('Already paid', 409);
          if (entry.status !== 'earned') throw new AppError(`An entry is ${entry.status} and cannot be paid`, 409);
          if (rewardOnly && entry.kind !== 'reward') throw new AppError('Delivery agents are paid target rewards only', 400);
        }

        const owed = summarize(locked).owed;
        if (!owed.gt(0)) {
          const hasPaid = await tx.commissionEntry.count({ where: { userId: payee.id, status: 'paid', ...(rewardOnly ? { kind: 'reward' } : {}) } });
          if (hasPaid > 0) throw new AppError('Already paid', 409);
          throw new AppError('Nothing is owed to this person', 400);
        }
        const amount = input.amount === undefined ? owed : Money.parse(input.amount);
        if (!amount.gt(0)) throw new AppError('Amount must be above zero', 400);
        if (amount.gt(owed)) {
          const currency = await currencyOfTenant(payee.tenantId);
          throw new AppError(`Owed is ${Money.format(owed, currency, { symbol: CURRENCY_SIGN[currency], wholeIfZero: true })}`, 400);
        }

        const payout = await tx.payout.create({
          data: {
            tenantId: payee.tenantId as string,
            payeeId: payee.id,
            kind: payee.payoutKind,
            amount,
            method,
            reference,
            status: 'completed',
            ...(input.payoutDate ? { payoutDate: input.payoutDate } : {}),
            notes: input.notes?.trim() || null,
            recordedById,
          },
        });

        const byId = new Map(locked.map((e) => [e.id, e]));
        const whole: number[] = [];
        for (const a of allocateOldestFirst(locked, amount)) {
          if (a.remainder.gt(0)) {
            // Partial payment: the paid part stays on this entry, the rest becomes a new open entry with the same ledger link
            const entry = byId.get(a.entryId)!;
            await tx.commissionEntry.create({
              data: {
                tenantId: entry.tenantId, orderId: entry.orderId, userId: entry.userId, kind: entry.kind, status: 'earned',
                amount: a.remainder, earnedAt: entry.earnedAt, journalEntryId: entry.journalEntryId,
                note: `Rest of entry ${entry.id} after payout ${payout.id}`,
              },
            });
            await tx.commissionEntry.update({ where: { id: entry.id }, data: { status: 'paid', payoutId: payout.id, amount: a.pay } });
          } else {
            whole.push(a.entryId);
          }
        }
        await tx.commissionEntry.updateMany({ where: { id: { in: whole } }, data: { status: 'paid', payoutId: payout.id } });

        await GLAutomationService.recordCommissionPayout(tx as any, payout.id, payee.id, amount, recordedById, {
          entryDate: payout.payoutDate,
          tenantId: payee.tenantId as string,
        });

        return tx.payout.findFirstOrThrow({
          where: { id: payout.id },
          include: { commissionEntries: { select: { id: true, orderId: true, kind: true, amount: true } } },
        });
      });
    } catch (error: any) {
      // Two payouts with the same reference at the same moment: the unique key (tenant, payee, method, reference) answers the second
      if (error?.code === 'P2002') throw new AppError('This reference was already used for this person and method', 409);
      throw error;
    }
  }
}

export default new PayoutService();
