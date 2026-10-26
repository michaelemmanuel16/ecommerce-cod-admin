import { CommissionEntry, JournalSourceType } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { TransactionClient } from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import logger from '../utils/logger';
import { GLAutomationService } from './glAutomationService';
import * as Money from '../utils/money';

/**
 * Commission posting (F-914, M5-T18). A `CommissionEntry` is the pay ledger of a rep. When it is earned it posts
 * DR 5050 Sales rep commission, CR 2020 Commissions payable. A returned order voids its open entries and reverses
 * the posting. The payout (payoutService) later debits 2020 and marks the entries paid.
 *
 * Creating entries for new orders is M7; this file only posts, reverses and (commissionBackfillService) backfills.
 * Everything runs in the caller's transaction and is idempotent.
 */

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
    where: { id: { in: open.flatMap((e) => (e.journalEntryId ? [e.journalEntryId] : [])) }, sourceType: JournalSourceType.manual },
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
