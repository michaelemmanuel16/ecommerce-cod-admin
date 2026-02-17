#!/usr/bin/env ts-node
/**
 * Backfill GL journal entries for historical commission payouts.
 *
 * For each completed Payout without a corresponding JournalEntry
 * (sourceType='payout', sourceId=payout.id), creates:
 *   DR  Commissions Payable (2020)  [amount]
 *   CR  Cash in Hand        (1010)  [amount]
 *
 * Safe to re-run — idempotent check prevents double-posting.
 *
 * Usage: npm run backfill:payout-gl
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { GLAutomationService } from '../src/services/glAutomationService';

const prisma = new PrismaClient();

async function main() {
  console.log('=== Backfill Payout GL Entries ===\n');

  // 1. Get all completed payouts
  const payouts = await prisma.payout.findMany({
    where: { status: 'completed' },
    include: { rep: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { payoutDate: 'asc' },
  });

  console.log(`Found ${payouts.length} completed payout(s) to check.\n`);

  if (payouts.length === 0) {
    console.log('No completed payouts found. Nothing to do.');
    return;
  }

  // 2. Find which payouts already have GL entries
  const existingEntries = await prisma.journalEntry.findMany({
    where: {
      sourceType: 'payout',
      sourceId: { in: payouts.map(p => p.id) },
    },
    select: { sourceId: true },
  });
  const payoutsWithEntry = new Set(existingEntries.map(e => e.sourceId));

  // 3. Filter to payouts that need backfilling
  const toBackfill = payouts.filter(p => !payoutsWithEntry.has(p.id));

  if (toBackfill.length === 0) {
    console.log('✓ All payouts already have GL journal entries. Nothing to do.');
    return;
  }

  // 4. Find a system user (first admin/super_admin) to use as createdBy
  const systemUser = await prisma.user.findFirst({
    where: { role: { in: ['super_admin', 'admin'] } },
    select: { id: true },
  });
  if (!systemUser) {
    throw new Error('No admin user found. Cannot create journal entries.');
  }
  const systemUserId = systemUser.id;

  console.log(`Payouts to backfill (${toBackfill.length}):`);
  toBackfill.forEach(p => {
    const name = `${p.rep.firstName} ${p.rep.lastName}`;
    const date = p.payoutDate.toISOString().split('T')[0];
    console.log(`  • Payout #${p.id} — Rep: ${name} — Amount: GHS ${p.amount} — Date: ${date}`);
  });
  console.log('');

  // 5. Create journal entries for each payout missing one
  let successCount = 0;
  let errorCount = 0;

  for (const payout of toBackfill) {
    try {
      await prisma.$transaction(async (tx) => {
        await GLAutomationService.recordCommissionPayout(
          tx as any,
          payout.id,
          payout.repId,
          new Decimal(payout.amount.toString()),
          systemUserId
        );
      });
      console.log(`  ✓ Created GL entry for Payout #${payout.id} (GHS ${payout.amount})`);
      successCount++;
    } catch (err) {
      console.error(`  ✗ Failed for Payout #${payout.id}:`, err);
      errorCount++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Checked:    ${payouts.length} completed payout(s)`);
  console.log(`  Skipped:    ${payoutsWithEntry.size} (already had GL entries)`);
  console.log(`  Backfilled: ${successCount}`);
  if (errorCount > 0) {
    console.log(`  Errors:     ${errorCount}`);
  }
  console.log(`\nDone. Commissions Payable (2020) balance should now reflect paid-out commissions.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
