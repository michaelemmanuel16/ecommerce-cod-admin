#!/usr/bin/env ts-node
/**
 * Backfill GL journal entries for historical COD deposits.
 *
 * For each Transaction with type='cod_collection' and status in
 * ('deposited', 'reconciled') that lacks a covering JournalEntry
 * (sourceType='agent_deposit'), creates:
 *   DR  Cash in Hand    (1010)  [amount]
 *   CR  Cash in Transit (1015)  [amount]
 *
 * Safe to re-run — idempotent check prevents double-posting.
 * Skips transactions whose order's AgentCollection is already
 * 'reconciled' (the reconciliation path already created the entry).
 *
 * Usage: npx ts-node scripts/backfill-deposit-gl-entries.ts
 */

import { PrismaClient } from '@prisma/client';
import { GLAutomationService } from '../src/services/glAutomationService';

const prisma = new PrismaClient();
const BATCH_SIZE = 50;

async function main() {
  console.log('=== Backfill Deposit GL Entries ===\n');

  // 1. Get all deposited/reconciled COD transactions
  const transactions = await prisma.transaction.findMany({
    where: {
      type: 'cod_collection',
      status: { in: ['deposited', 'reconciled'] },
      order: { deletedAt: null },
    },
    include: {
      order: { select: { id: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${transactions.length} deposited/reconciled transaction(s) to check.\n`);

  if (transactions.length === 0) {
    console.log('No transactions found. Nothing to do.');
    return;
  }

  // 2. Find which transactions already have deposit GL entries
  // We check by sourceType='agent_deposit' and sourceId=transaction.id
  const existingEntries = await prisma.journalEntry.findMany({
    where: {
      sourceType: 'agent_deposit',
      sourceId: { in: transactions.map((t: any) => t.id) },
    },
    select: { sourceId: true },
  });
  const transactionsWithEntry = new Set(existingEntries.map((e: any) => e.sourceId));

  // 3. Filter to transactions needing backfill
  const toBackfill = transactions.filter((t: any) => !transactionsWithEntry.has(t.id));

  if (toBackfill.length === 0) {
    console.log('✓ All deposited transactions already have GL journal entries. Nothing to do.');
    return;
  }

  // 4. Exclude transactions where AgentCollection is already reconciled
  // (collection reconciliation path already created the Cash in Transit -> Cash in Hand entry)
  const orderIds = toBackfill.map((t: any) => t.orderId).filter(Boolean);
  const reconciledCollections = await prisma.agentCollection.findMany({
    where: {
      orderId: { in: orderIds },
      status: 'reconciled',
    },
    select: { orderId: true },
  });
  const reconciledOrderIds = new Set(reconciledCollections.map((c: any) => c.orderId));

  const eligible = toBackfill.filter((t: any) => !reconciledOrderIds.has(t.orderId));

  if (eligible.length === 0) {
    console.log('✓ All remaining transactions are covered by AgentCollection reconciliation entries. Nothing to do.');
    return;
  }

  // 5. Find a system user to use as createdBy
  const systemUser = await prisma.user.findFirst({
    where: { role: { in: ['super_admin', 'admin'] } },
    select: { id: true },
  });
  if (!systemUser) {
    throw new Error('No admin user found. Cannot create journal entries.');
  }
  const systemUserId = systemUser.id;

  console.log(`Transactions to backfill: ${eligible.length} (${toBackfill.length - eligible.length} skipped — covered by reconciliation)\n`);

  // 6. Process in batches
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < eligible.length; i += BATCH_SIZE) {
    const batch = eligible.slice(i, i + BATCH_SIZE);

    for (const txRecord of batch) {
      try {
        await prisma.$transaction(async (tx) => {
          await GLAutomationService.createDepositGLEntry(
            tx as any,
            Number(txRecord.amount),
            txRecord.id,
            systemUserId
          );
        });
        successCount++;
        if (successCount % 10 === 0) {
          console.log(`  Progress: ${successCount}/${eligible.length}`);
        }
      } catch (err) {
        console.error(`  ✗ Failed for Transaction #${txRecord.id}:`, err);
        errorCount++;
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Checked:         ${transactions.length} transaction(s)`);
  console.log(`  Already covered: ${transactionsWithEntry.size} (existing GL entries)`);
  console.log(`  Skipped (recon): ${toBackfill.length - eligible.length}`);
  console.log(`  Backfilled:      ${successCount}`);
  if (errorCount > 0) {
    console.log(`  Errors:          ${errorCount}`);
  }
  console.log('\nDone. Cash in Hand (1010) should now reflect all COD deposits.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
