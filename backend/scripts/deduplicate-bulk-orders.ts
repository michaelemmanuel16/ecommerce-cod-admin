/**
 * Deduplicates bulk-imported orders where the same real-world order
 * was imported multiple times (same phone + amount + address + orderDate).
 *
 * Strategy: For each group of duplicate orders, KEEP the one with the
 * furthest-along status and soft-delete the rest.
 *
 * Safe to run on local, staging, and production.
 */

import { PrismaClient, OrderStatus } from '@prisma/client';

const prisma = new PrismaClient();

// Status progression — higher index = further along
const STATUS_ORDER: OrderStatus[] = [
  'pending_confirmation',
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'out_for_delivery',
  'delivered',
];

function statusRank(status: OrderStatus): number {
  const idx = STATUS_ORDER.indexOf(status);
  return idx === -1 ? -1 : idx; // terminal states (cancelled, returned, failed) → -1
}

const normalize = (val: string | null | undefined) =>
  String(val || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim();

async function deduplicateBulkOrders(dryRun = true) {
  console.log(`\n=== Bulk Order Deduplication (${dryRun ? 'DRY RUN' : 'LIVE'}) ===\n`);

  // Fetch all live bulk-imported orders with customer phone
  const orders = await prisma.order.findMany({
    where: { source: 'bulk_import', deletedAt: null },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      deliveryAddress: true,
      createdAt: true,
      customer: { select: { phoneNumber: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${orders.length} live bulk-imported orders`);

  // Group by fingerprint: phone + amount + normalizedAddress + date (yyyy-mm-dd)
  const groups = new Map<string, typeof orders>();

  for (const order of orders) {
    const phone = order.customer?.phoneNumber || '';
    const dateKey = new Date(order.createdAt).toISOString().slice(0, 10); // YYYY-MM-DD
    const fingerprint = `${phone}|${order.totalAmount}|${normalize(order.deliveryAddress)}|${dateKey}`;

    if (!groups.has(fingerprint)) groups.set(fingerprint, []);
    groups.get(fingerprint)!.push(order);
  }

  const duplicateGroups = [...groups.values()].filter(g => g.length > 1);
  console.log(`Found ${duplicateGroups.length} groups with duplicates\n`);

  if (duplicateGroups.length === 0) {
    console.log('No duplicates found. Nothing to do.');
    return;
  }

  let toKeep: number[] = [];
  let toDelete: number[] = [];

  for (const group of duplicateGroups) {
    // Sort by status rank descending, then by id ascending (oldest first as tiebreak)
    const sorted = [...group].sort((a, b) => {
      const rankDiff = statusRank(b.status) - statusRank(a.status);
      return rankDiff !== 0 ? rankDiff : a.id - b.id;
    });

    const winner = sorted[0];
    const losers = sorted.slice(1);

    toKeep.push(winner.id);
    toDelete.push(...losers.map(o => o.id));

    console.log(`Group (phone: ${group[0].customer?.phoneNumber}, amount: ${group[0].totalAmount}, date: ${new Date(group[0].createdAt).toISOString().slice(0,10)}):`);
    console.log(`  KEEP  #${winner.id} [${winner.status}]`);
    for (const loser of losers) {
      console.log(`  DEL   #${loser.id} [${loser.status}]`);
    }
  }

  console.log(`\nSummary: ${toKeep.length} to keep, ${toDelete.length} to soft-delete`);

  if (dryRun) {
    console.log('\nDRY RUN — no changes made. Re-run with --live to apply.');
    return;
  }

  // Soft-delete the losers
  const result = await prisma.order.updateMany({
    where: { id: { in: toDelete } },
    data: { deletedAt: new Date() },
  });
  console.log(`\nSoft-deleted ${result.count} duplicate orders`);

  // Cleanup orphaned customers
  const orphaned = await prisma.customer.findMany({
    where: { orders: { none: { deletedAt: null } } },
    select: { id: true, firstName: true, lastName: true, phoneNumber: true },
  });

  if (orphaned.length > 0) {
    console.log(`\nOrphaned customers after dedup: ${orphaned.length}`);
    orphaned.forEach(c => console.log(`  #${c.id}: ${c.firstName} ${c.lastName} (${c.phoneNumber})`));

    const readline = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>(resolve => {
      readline.question('\nDelete orphaned customers? (yes/no): ', async (answer: string) => {
        if (answer.toLowerCase() === 'yes') {
          await prisma.order.deleteMany({ where: { customerId: { in: orphaned.map(c => c.id) } } });
          await prisma.customer.deleteMany({ where: { id: { in: orphaned.map(c => c.id) } } });
          console.log(`Deleted ${orphaned.length} orphaned customers`);
        } else {
          console.log('Skipped customer deletion');
        }
        readline.close();
        resolve();
      });
    });
  }

  console.log('\nDeduplication complete.');
}

const isLive = process.argv.includes('--live');
deduplicateBulkOrders(!isLive)
  .catch(console.error)
  .finally(() => prisma.$disconnect());
