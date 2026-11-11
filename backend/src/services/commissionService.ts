import { CommissionEntry, CommissionKind, JournalSourceType, Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { TransactionClient } from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import logger from '../utils/logger';
import { GLAutomationService } from './glAutomationService';
import * as Money from '../utils/money';
import { getRepPay } from './rewardService';

/**
 * Commission posting (F-914, M5-T18, M7-T02). A `CommissionEntry` is the pay ledger of a rep.
 * When an order is confirmed by a call rep: base and upsell entries pending (P6) driven by tenant reward settings.
 * On delivery: pending entries flip to earned and post DR 5050 Sales rep commission, CR 2020 Commissions payable.
 * On return or cancel: void open entries and reverse GL accruals. Deduct paid entries.
 */

export function upsellCommissionFor(extraValue: Money.MoneyInput, rate: Prisma.Decimal | string | number): Prisma.Decimal {
  return Money.roundHalfUp(Money.mul(extraValue, rate), 2);
}

/**
 * Creates pending commission entries on order confirmation by a rep call (F-769, P6, COD-193).
 * Base amount and upsell percent are driven by the tenant's reward settings.
 * Only human reps (kind === 'person') qualify; auto-confirmed, self-service, no-rep, and AI-agent orders get no entries.
 * Idempotent: if live base/upsell entries already exist for this order, they are not duplicated.
 */
export async function createCommissionEntriesOnConfirm(
  tx: TransactionClient,
  orderId: number,
  confirmingRepId: number,
): Promise<{ baseEntry: CommissionEntry | null; upsellEntry: CommissionEntry | null }> {
  const rep = await tx.user.findUnique({
    where: { id: confirmingRepId },
    select: { id: true, kind: true, role: true, tenantId: true },
  });
  // Auto-confirmed, self-service, no-rep and AI-agent orders: no entries (owner decision: no entry for AI agents)
  if (!rep || rep.kind !== 'person' || rep.role !== 'sales_rep') {
    return { baseEntry: null, upsellEntry: null };
  }

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: { id: true, tenantId: true },
  });
  if (!order) throw new AppError('Order not found', 404);
  const tenantId = resolveTenantId(order.tenantId);
  const repPay = await getRepPay(tx, tenantId);

  // 1. Base entry from tenant setting
  let baseEntry = await tx.commissionEntry.findFirst({
    where: { orderId, kind: 'base', status: { not: 'void' } },
  });
  if (!baseEntry) {
    baseEntry = await tx.commissionEntry.create({
      data: {
        tenantId,
        orderId,
        userId: confirmingRepId,
        kind: 'base',
        status: 'pending',
        amount: repPay.base,
        note: 'Base commission on call confirmation (M7)',
      },
    });
  }

  // 2. Upsell entry: upsellRate of active UpsellLine extra value pending
  const upsellLines = await tx.upsellLine.findMany({
    where: { orderId, status: 'active' },
  });
  const extraValueSum = Money.sum(upsellLines.map((l) => l.extraValue));
  let upsellEntry = await tx.commissionEntry.findFirst({
    where: { orderId, kind: 'upsell', status: { not: 'void' } },
  });
  if (extraValueSum.gt(0)) {
    const upsellAmount = upsellCommissionFor(extraValueSum, repPay.upsellRate);
    if (upsellAmount.gt(0)) {
      if (!upsellEntry) {
        upsellEntry = await tx.commissionEntry.create({
          data: {
            tenantId,
            orderId,
            userId: confirmingRepId,
            kind: 'upsell',
            status: 'pending',
            amount: upsellAmount,
            note: 'Upsell commission on call confirmation (M7)',
          },
        });
      } else if (upsellEntry.status === 'pending' && !Money.parse(upsellEntry.amount).equals(upsellAmount)) {
        upsellEntry = await tx.commissionEntry.update({
          where: { id: upsellEntry.id },
          data: { amount: upsellAmount },
        });
      }
    }
  }

  return { baseEntry, upsellEntry };
}

/**
 * Delivery flips entries to earned exactly once (idempotent, re-delivery event does nothing).
 * Posts earned entries to the GL ledger (DR 5050 / CR 2020) via postEntry.
 */
export async function earnEntriesForOrder(
  tx: TransactionClient,
  orderId: number,
  actorUserIdResolver: number | (() => Promise<number>),
  earnedAt?: Date,
): Promise<{ earned: number; posted: number }> {
  const pending = await tx.$queryRaw<{ id: number }[]>`
    SELECT id FROM commission_entries
    WHERE order_id = ${orderId} AND tenant_id = ${resolveTenantId()} AND status = 'pending'
    ORDER BY id FOR UPDATE`;
  if (pending.length === 0) return { earned: 0, posted: 0 };

  const actorUserId = typeof actorUserIdResolver === 'function'
    ? await actorUserIdResolver()
    : actorUserIdResolver;

  const effectiveDate = earnedAt ?? new Date();
  let postedCount = 0;
  for (const { id } of pending) {
    await tx.commissionEntry.update({
      where: { id },
      data: { status: 'earned', earnedAt: effectiveDate },
    });
    const res = await postEntry(tx, id, actorUserId);
    if (res.posted) postedCount++;
  }
  logger.info(`Earned and posted ${pending.length} commission entries for order ${orderId}`);
  return { earned: pending.length, posted: postedCount };
}

/** Lock one entry row for the rest of the transaction, so two callers on the same entry take turns. */
export async function lockEntry(tx: TransactionClient, entryId: number): Promise<CommissionEntry | null> {
  await tx.$queryRaw`SELECT id FROM commission_entries WHERE id = ${entryId} AND tenant_id = ${resolveTenantId()} FOR UPDATE`;
  return tx.commissionEntry.findFirst({ where: { id: entryId } });
}

/**
 * Posts one `earned` entry to the ledger (DR 5050, CR 2020) and stores the journal entry id on it.
 * A repeat returns the entry as it is and posts nothing. Zero-amount and non-earned entries are refused.
 */
export async function postEntry(
  tx: TransactionClient,
  entryId: number,
  userId: number,
): Promise<{ entry: CommissionEntry; posted: boolean }> {
  const entry = await lockEntry(tx, entryId);
  if (!entry) throw new AppError('Commission entry not found', 404);
  if (entry.journalEntryId) return { entry, posted: false };
  if (entry.status !== 'earned') throw new AppError(`Only earned commission posts to the ledger (this one is ${entry.status})`, 409);
  if (!Money.parse(entry.amount).gt(0)) throw new AppError('A commission of zero does not post', 400);

  const journal = await GLAutomationService.recordCommissionAccrual(
    tx,
    { id: entry.id, tenantId: entry.tenantId, orderId: entry.orderId, amount: entry.amount },
    userId,
    entry.earnedAt ?? new Date(),
  );
  const updated = await tx.commissionEntry.update({ where: { id: entry.id }, data: { journalEntryId: journal.id } });
  return { entry: updated, posted: true };
}

/**
 * A returned order (or any move out of delivered) voids its open entries: `pending` and `earned` become `void`.
 * Paid entries have deductions created (COD-193): for each (userId, kind) with paid amount > 0, an earned entry with
 * negative amount is created, and own commission accruals reversed (DR 2020, CR 5050).
 * Idempotent: repeat calls create no second deduction.
 * Returns the number of entries voided.
 */
export async function voidOpenEntriesForOrder(tx: TransactionClient, orderId: number, actorId: () => Promise<number>): Promise<number> {
  const tenantId = resolveTenantId();

  // 1. Lock open and paid entries in one query (amount > 0). A deduction (amount < 0) is never voided here: a repeat
  // call would void it and post a second one, so the GL would take the commission back twice.
  const locked = await tx.$queryRaw<{
    id: number;
    tenantId: string;
    orderId: number;
    userId: number;
    kind: CommissionKind;
    status: string;
    amount: Money.Money;
    journalEntryId: number | null;
  }[]>`
    SELECT id, tenant_id AS "tenantId", order_id AS "orderId", user_id AS "userId", kind, status, amount, journal_entry_id AS "journalEntryId"
    FROM commission_entries
    WHERE order_id = ${orderId} AND tenant_id = ${tenantId} AND status IN ('pending', 'earned', 'paid') AND amount > 0
    ORDER BY id FOR UPDATE`;
  const open = locked.filter((e) => e.status !== 'paid');
  const paid = locked.filter((e) => e.status === 'paid');

  if (open.length > 0) {
    const posted = await tx.journalEntry.findMany({
      where: { id: { in: open.flatMap((e) => (e.journalEntryId ? [e.journalEntryId] : [])) }, sourceType: JournalSourceType.commission_accrual },
      select: { id: true },
    });
    const ownPosting = new Set(posted.map((j) => j.id));
    for (const entry of open) {
      if (entry.journalEntryId && ownPosting.has(entry.journalEntryId)) {
        await GLAutomationService.reverseCommissionAccrual(tx, entry, await actorId());
      }
    }
    await tx.commissionEntry.updateMany({ where: { id: { in: open.map((e) => e.id) } }, data: { status: 'void' } });
    logger.info(`Voided ${open.length} commission entries of order ${orderId}`);
  }

  // 2. Paid entries get deductions
  if (paid.length > 0) {
    // Group paid entries by (userId, kind)
    const groups = new Map<string, typeof paid>();
    for (const p of paid) {
      const key = `${p.userId}:${p.kind}`;
      const list = groups.get(key) ?? [];
      list.push(p);
      groups.set(key, list);
    }

    const paidJeIds = paid.flatMap((e) => (e.journalEntryId ? [e.journalEntryId] : []));
    const posted = paidJeIds.length > 0
      ? await tx.journalEntry.findMany({
          where: { id: { in: paidJeIds }, sourceType: JournalSourceType.commission_accrual },
          select: { id: true },
        })
      : [];
    const ownPosting = new Set(posted.map((j) => j.id));

    for (const groupEntries of groups.values()) {
      const { userId, kind } = groupEntries[0];
      const existingDeduction = await tx.commissionEntry.findFirst({
        where: {
          tenantId,
          orderId,
          userId,
          kind,
          amount: { lt: 0 },
          status: { not: 'void' },
        },
      });

      if (!existingDeduction) {
        const totalPaid = Money.sum(groupEntries.map((e) => e.amount));
        const deductionAmount = totalPaid.negated();

        const deduction = await tx.commissionEntry.create({
          data: {
            tenantId,
            orderId,
            userId,
            kind,
            status: 'earned',
            amount: deductionAmount,
            earnedAt: new Date(),
            note: `Order #${orderId} returned`,
          },
        });

        // GL: only when paid entry's journalEntryId is the service's own commission_accrual posting
        const hasOwnAccrual = groupEntries.some((e) => e.journalEntryId && ownPosting.has(e.journalEntryId));
        if (hasOwnAccrual) {
          const reversalJournal = await GLAutomationService.reverseCommissionAccrual(
            tx,
            { id: deduction.id, tenantId, orderId, amount: totalPaid },
            await actorId()
          );
          await tx.commissionEntry.update({
            where: { id: deduction.id },
            data: { journalEntryId: reversalJournal.id },
          });
        }
      }
    }
  }

  return open.length;
}
