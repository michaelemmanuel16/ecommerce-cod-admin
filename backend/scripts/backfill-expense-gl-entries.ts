#!/usr/bin/env ts-node
/**
 * Backfill GL journal entries for historical expenses.
 *
 * For each Expense without a corresponding JournalEntry
 * (sourceType='expense', sourceId=expense.id), creates:
 *   DR  Operating Expenses (5100)  [amount]
 *   CR  Cash in Hand       (1010)  [amount]
 *
 * Safe to re-run — idempotent check prevents double-posting.
 *
 * Usage: npx ts-node scripts/backfill-expense-gl-entries.ts
 */

import { PrismaClient } from '@prisma/client';
import { GLAutomationService } from '../src/services/glAutomationService';

const prisma = new PrismaClient();
const BATCH_SIZE = 50;

async function main() {
  console.log('=== Backfill Expense GL Entries ===\n');

  // 1. Get all expenses ordered by date
  const expenses = await prisma.expense.findMany({
    orderBy: { expenseDate: 'asc' },
  });

  console.log(`Found ${expenses.length} expense(s) to check.\n`);

  if (expenses.length === 0) {
    console.log('No expenses found. Nothing to do.');
    return;
  }

  // 2. Find which expenses already have GL entries
  const existingEntries = await prisma.journalEntry.findMany({
    where: {
      sourceType: 'expense',
      sourceId: { in: expenses.map(e => e.id) },
    },
    select: { sourceId: true },
  });
  const expensesWithEntry = new Set(existingEntries.map(e => e.sourceId));

  // 3. Filter to expenses that need backfilling
  const toBackfill = expenses.filter(e => !expensesWithEntry.has(e.id));

  if (toBackfill.length === 0) {
    console.log('✓ All expenses already have GL journal entries. Nothing to do.');
    return;
  }

  // 4. Find a system user to use as createdBy
  const systemUser = await prisma.user.findFirst({
    where: { role: { in: ['super_admin', 'admin'] } },
    select: { id: true },
  });
  if (!systemUser) {
    throw new Error('No admin user found. Cannot create journal entries.');
  }
  const systemUserId = systemUser.id;

  console.log(`Expenses to backfill: ${toBackfill.length}\n`);

  // 5. Process in batches
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < toBackfill.length; i += BATCH_SIZE) {
    const batch = toBackfill.slice(i, i + BATCH_SIZE);

    for (const expense of batch) {
      try {
        await prisma.$transaction(async (tx) => {
          await GLAutomationService.createExpenseGLEntry(
            tx as any,
            expense.id,
            expense.amount,
            expense.description,
            expense.recordedBy ?? systemUserId
          );
        });
        successCount++;
        if (successCount % 10 === 0) {
          console.log(`  Progress: ${successCount}/${toBackfill.length}`);
        }
      } catch (err) {
        console.error(`  ✗ Failed for Expense #${expense.id} (${expense.category}):`, err);
        errorCount++;
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Checked:    ${expenses.length} expense(s)`);
  console.log(`  Skipped:    ${expensesWithEntry.size} (already had GL entries)`);
  console.log(`  Backfilled: ${successCount}`);
  if (errorCount > 0) {
    console.log(`  Errors:     ${errorCount}`);
  }
  console.log('\nDone. Operating Expenses (5100) balance should now reflect all recorded expenses.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
