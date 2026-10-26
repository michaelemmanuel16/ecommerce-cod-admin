import { CommissionKind, PayoutKind, Prisma } from '@prisma/client';
import prisma, { TransactionClient } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { GLAutomationService } from './glAutomationService';
import { lockEntry } from './commissionService';
import * as Money from '../utils/money';

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

const AGENT_KINDS: CommissionKind[] = ['reward'];

export interface OpenEntry {
  id: number;
  orderId: number | null;
  kind: CommissionKind;
  amount: Money.Money;
  earnedAt: Date | null;
}

export interface Allocation {
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
    const pay = Money.parse(e.amount).lt(left) ? Money.parse(e.amount) : left;
    out.push({ entryId: e.id, pay, remainder: Money.parse(e.amount).minus(pay) });
    left = left.minus(pay);
  }
  if (left.gt(0)) throw new RangeError('Amount is above what the entries hold');
  return out;
}

/** "GH₵2,034" or "GH₵2,034.50": the store currency sign, whole amounts without decimals. */
export function formatOwed(amount: Money.MoneyInput, currency: string): string {
  const sign = currency === 'GHS' ? 'GH₵' : currency === 'NGN' ? '₦' : `${currency} `;
  const [whole, decimals] = Money.toApi(amount).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return /^0+$/.test(decimals ?? '') ? `${sign}${grouped}` : `${sign}${grouped}.${decimals}`;
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
    const payee = await tx.user.findFirst({
      where: { id: payeeId },
      select: { id: true, tenantId: true, firstName: true, lastName: true, role: true, kind: true, isActive: true },
    });
    if (!payee) throw new AppError('Person not found', 404);
    if (payee.kind === 'ai_agent') throw new AppError('No payout for AI agents', 400);
    if (payee.kind !== 'person') throw new AppError('Only people are paid through a payout', 400);
    const kind: PayoutKind = payee.role === 'delivery_agent' ? 'agent' : 'rep';
    return { ...payee, payoutKind: kind };
  }

  /** The preview of the form: what the person earned, what was paid, what is owed, and the open entries to tick. */
  async getOwed(payeeId: number) {
    const payee = await this.loadPayee(prisma, payeeId);
    const kinds = payee.payoutKind === 'agent' ? AGENT_KINDS : undefined;
    const rows = await prisma.commissionEntry.findMany({
      where: { userId: payeeId, status: { in: ['earned', 'paid'] }, ...(kinds ? { kind: { in: kinds } } : {}) },
      orderBy: [{ earnedAt: 'asc' }, { id: 'asc' }],
      select: { id: true, orderId: true, kind: true, status: true, amount: true, earnedAt: true, payoutId: true },
    });
    const sum = (filter: (r: (typeof rows)[number]) => boolean) => Money.sum(rows.filter(filter).map((r) => r.amount));
    const open = rows.filter((r) => r.status === 'earned' && r.payoutId === null);
    return {
      payee: { id: payee.id, firstName: payee.firstName, lastName: payee.lastName, role: payee.role, kind: payee.payoutKind },
      commission: sum((r) => r.kind === 'base'),
      upsellReward: sum((r) => r.kind === 'upsell'),
      targetReward: sum((r) => r.kind === 'reward'),
      earned: sum(() => true),
      paid: sum((r) => r.status === 'paid'),
      owed: sum((r) => open.includes(r)),
      entries: open.map((r) => ({ id: r.id, orderId: r.orderId, kind: r.kind, amount: r.amount, earnedAt: r.earnedAt })),
    };
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
        const tenant = await tx.tenant.findUnique({ where: { id: payee.tenantId as string }, select: { currency: true } });
        const currency = tenant?.currency ?? 'GHS';
        const method = input.method.trim();
        const reference = input.reference?.trim() || null;
        const kinds = payee.payoutKind === 'agent' ? AGENT_KINDS : null;

        if (reference) {
          const used = await tx.payout.findFirst({ where: { payeeId: payee.id, method, reference }, select: { id: true } });
          if (used) throw new AppError('This reference was already used for this person and method', 409);
        }

        // Lock the entries first: two payouts on the same entries take turns, and the second finds them paid.
        let ids: number[];
        if (input.entryIds && input.entryIds.length > 0) {
          ids = [...new Set(input.entryIds)].sort((a, b) => a - b);
        } else {
          const onlyRewards = kinds ? Prisma.sql`AND kind = 'reward'` : Prisma.empty;
          const open = await (tx as any).$queryRaw<{ id: number }[]>`
            SELECT id FROM commission_entries
            WHERE tenant_id = ${payee.tenantId} AND user_id = ${payee.id} AND status = 'earned' AND payout_id IS NULL ${onlyRewards}
            ORDER BY id FOR UPDATE`;
          ids = open.map((r: { id: number }) => r.id);
        }
        const entries: OpenEntry[] = [];
        for (const id of ids) {
          const entry = await lockEntry(tx, id);
          if (!entry || entry.userId !== payee.id) throw new AppError('An entry is not this person\'s', 400);
          if (entry.status === 'paid' || entry.payoutId !== null) throw new AppError('Already paid', 409);
          if (entry.status !== 'earned') throw new AppError(`An entry is ${entry.status} and cannot be paid`, 409);
          if (kinds && !kinds.includes(entry.kind)) throw new AppError('Delivery agents are paid target rewards only', 400);
          entries.push({ id: entry.id, orderId: entry.orderId, kind: entry.kind, amount: Money.parse(entry.amount), earnedAt: entry.earnedAt });
        }

        const owed = Money.sum(entries.map((e) => e.amount));
        if (entries.length === 0 || !owed.gt(0)) {
          const hasPaid = await tx.commissionEntry.count({ where: { userId: payee.id, status: 'paid', ...(kinds ? { kind: { in: kinds } } : {}) } });
          if (hasPaid > 0) throw new AppError('Already paid', 409);
          throw new AppError('Nothing is owed to this person', 400);
        }
        const amount = input.amount === undefined ? owed : Money.parse(input.amount);
        if (!amount.gt(0)) throw new AppError('Amount must be above zero', 400);
        if (amount.gt(owed)) throw new AppError(`Owed is ${formatOwed(owed, currency)}`, 400);

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

        for (const a of allocateOldestFirst(entries, amount)) {
          const entry = await tx.commissionEntry.findFirstOrThrow({ where: { id: a.entryId } });
          if (a.remainder.gt(0)) {
            // Partial payment: the paid part stays on this entry, the rest becomes a new open entry with the same ledger link
            await tx.commissionEntry.create({
              data: {
                tenantId: entry.tenantId, orderId: entry.orderId, userId: entry.userId, kind: entry.kind, status: 'earned',
                amount: a.remainder, earnedAt: entry.earnedAt, journalEntryId: entry.journalEntryId,
                note: `Rest of entry ${entry.id} after payout ${payout.id}`,
              },
            });
          }
          await tx.commissionEntry.update({ where: { id: entry.id }, data: { status: 'paid', payoutId: payout.id, amount: a.pay } });
        }

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
