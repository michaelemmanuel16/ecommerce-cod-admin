import { CommissionEntry, JournalSourceType, Prisma } from '@prisma/client';
import { AppError } from '../middleware/errorHandler';
import { TransactionClient } from '../utils/prisma';
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
  await (tx as any).$queryRaw`SELECT id FROM commission_entries WHERE id = ${entryId} FOR UPDATE`;
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
    tx as any,
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
 * Returns the number of entries voided.
 */
export async function voidOpenEntriesForOrder(tx: TransactionClient, orderId: number, userId: number): Promise<number> {
  const open = await tx.commissionEntry.findMany({
    where: { orderId, status: { in: ['pending', 'earned'] } },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  let voided = 0;
  for (const { id } of open) {
    const entry = await lockEntry(tx, id);
    // Another transaction may have paid or voided it while this one waited for the lock
    if (!entry || (entry.status !== 'pending' && entry.status !== 'earned')) continue;

    if (entry.journalEntryId) {
      const journal = await tx.journalEntry.findFirst({
        where: { id: entry.journalEntryId },
        select: { sourceType: true },
      });
      if (journal?.sourceType === JournalSourceType.manual) {
        await GLAutomationService.reverseCommissionAccrual(
          tx as any,
          { id: entry.id, tenantId: entry.tenantId, orderId: entry.orderId, amount: entry.amount },
          userId,
        );
      }
    }
    await tx.commissionEntry.update({ where: { id: entry.id }, data: { status: 'void' } });
    voided++;
  }
  if (voided > 0) logger.info(`Voided ${voided} commission entries of order ${orderId}`);
  return voided;
}

/** What a payee is owed: the sum of their `earned` entries not yet linked to a payout. */
export async function owedOf(
  tx: TransactionClient | Prisma.TransactionClient,
  payeeId: number,
  kinds?: Array<'base' | 'upsell' | 'reward'>,
): Promise<Money.Money> {
  const rows = await (tx as TransactionClient).commissionEntry.findMany({
    where: { userId: payeeId, status: 'earned', payoutId: null, ...(kinds ? { kind: { in: kinds } } : {}) },
    select: { amount: true },
  });
  return Money.sum(rows.map((r) => r.amount));
}
