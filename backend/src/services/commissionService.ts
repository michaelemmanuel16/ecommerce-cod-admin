import { CommissionEntry, JournalSourceType, Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { TransactionClient } from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import logger from '../utils/logger';
import { GLAutomationService } from './glAutomationService';
import * as Money from '../utils/money';

/**
 * Commission posting (F-914, M5-T18, M7-T02). A `CommissionEntry` is the pay ledger of a rep.
 * When an order is confirmed by a call rep: base GH₵8 pending, upsell 10% pending (P6).
 * On delivery: pending entries flip to earned and post DR 5050 Sales rep commission, CR 2020 Commissions payable.
 * On return or cancel: void open entries and reverse GL accruals.
 */

export const BASE_COMMISSION_AMOUNT = Money.fromNumber(8);
export const UPSELL_COMMISSION_RATE = new Prisma.Decimal('0.10');

export function upsellCommissionFor(extraValue: Money.MoneyInput): Prisma.Decimal {
  return Money.roundHalfUp(Money.mul(extraValue, UPSELL_COMMISSION_RATE), 2);
}

/**
 * Creates pending commission entries (base GH₵8 and upsell 10%) on order confirmation by a rep call (F-769, P6).
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

  // 1. Base entry: GH₵8 pending
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
        amount: BASE_COMMISSION_AMOUNT,
        note: 'Base commission on call confirmation (M7)',
      },
    });
  }

  // 2. Upsell entry: 10% of active UpsellLine extra value pending
  const upsellLines = await tx.upsellLine.findMany({
    where: { orderId, status: 'active' },
  });
  const extraValueSum = Money.sum(upsellLines.map((l) => l.extraValue));
  let upsellEntry = await tx.commissionEntry.findFirst({
    where: { orderId, kind: 'upsell', status: { not: 'void' } },
  });
  if (extraValueSum.gt(0)) {
    const upsellAmount = upsellCommissionFor(extraValueSum);
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
 * Paid entries stay as they are. An entry whose posting this service made is reversed (DR 2020, CR 5050).
 * An entry that points at the delivery journal entry (backfilled from an old order) needs no second reversal: the
 * order's own revenue reversal already takes the commission back. An entry never posted has nothing to reverse.
 * `actorId` is read only when an entry needs a reversal. Returns the number of entries voided.
 */
export async function voidOpenEntriesForOrder(tx: TransactionClient, orderId: number, actorId: () => Promise<number>): Promise<number> {
  // One query takes every lock and returns the rows to work on; a payout that holds one makes this wait, then sees it paid
  const open = await tx.$queryRaw<{ id: number; tenantId: string; orderId: number | null; amount: Money.Money; journalEntryId: number | null }[]>`
    SELECT id, tenant_id AS "tenantId", order_id AS "orderId", amount, journal_entry_id AS "journalEntryId"
    FROM commission_entries
    WHERE order_id = ${orderId} AND tenant_id = ${resolveTenantId()} AND status IN ('pending', 'earned')
    ORDER BY id FOR UPDATE`;
  if (open.length === 0) return 0;

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
  return open.length;
}
