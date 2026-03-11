/**
 * Backfill OrderItems for February 2026 Imported Orders
 *
 * Orders imported via CSV bulk import in February 2026 were created without
 * OrderItems because the products didn't exist in the database at import time.
 * Now that products exist, this script creates the missing OrderItem records
 * based on totalAmount-to-product mapping.
 *
 * Product Mapping (by totalAmount):
 *   200 -> Dictamni Hemorrhoid Cream (DHC-001), qty 2, unitPrice 100
 *   260 -> Pile Combo (PCB-001), qty 1, unitPrice 260
 *   450 -> Magic Copybook (MCB-001), qty 2, unitPrice 225
 *
 * Usage:
 *   npm run backfill:order-items -- --dry-run   # Preview changes
 *   npm run backfill:order-items -- --execute   # Actually create entries
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ProductMapping {
  sku: string;
  quantity: number;
  unitPrice: number;
}

const AMOUNT_TO_PRODUCT: Record<number, ProductMapping> = {
  200: { sku: 'DHC-001', quantity: 2, unitPrice: 100 },
  260: { sku: 'PCB-001', quantity: 1, unitPrice: 260 },
  450: { sku: 'MCB-001', quantity: 2, unitPrice: 225 },
};

async function main(dryRun: boolean) {
  console.log('\n=== Backfill OrderItems for Imported Orders ===\n');
  console.log(`Mode: ${dryRun ? 'DRY RUN (Preview Only)' : 'EXECUTE (Creating Records)'}\n`);

  // 1. Look up products by SKU
  const skus = Object.values(AMOUNT_TO_PRODUCT).map((m) => m.sku);
  const products = await prisma.product.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true, name: true },
  });

  const productBySku = new Map(products.map((p) => [p.sku, p]));

  // Verify all products exist
  for (const sku of skus) {
    if (!productBySku.has(sku)) {
      console.error(`Product with SKU "${sku}" not found in database. Aborting.`);
      process.exit(1);
    }
  }
  console.log(`Found ${products.length} products: ${products.map((p) => `${p.sku} (${p.name})`).join(', ')}\n`);

  // 2. Find target orders: bulk_import, February 2026, no orderItems
  const orders = await prisma.order.findMany({
    where: {
      source: 'bulk_import',
      createdAt: {
        gte: new Date('2026-02-01T00:00:00Z'),
        lt: new Date('2026-03-01T00:00:00Z'),
      },
      orderItems: { none: {} },
      deletedAt: null,
    },
    select: {
      id: true,
      totalAmount: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${orders.length} imported February orders with no OrderItems.\n`);

  if (orders.length === 0) {
    console.log('Nothing to do.\n');
    return;
  }

  // 3. Process orders
  let created = 0;
  let skipped = 0;
  let errors = 0;
  const unmatchedAmounts: number[] = [];

  for (const order of orders) {
    const amount = Number(order.totalAmount);
    const mapping = AMOUNT_TO_PRODUCT[amount];

    if (!mapping) {
      skipped++;
      if (!unmatchedAmounts.includes(amount)) {
        unmatchedAmounts.push(amount);
      }
      console.log(`  [SKIP] Order #${order.id} - unmatched totalAmount: ${amount}`);
      continue;
    }

    const product = productBySku.get(mapping.sku)!;

    if (dryRun) {
      console.log(`  [DRY] Order #${order.id} (${amount}) -> ${product.name} x${mapping.quantity} @ ${mapping.unitPrice}`);
      created++;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: product.id,
            quantity: mapping.quantity,
            unitPrice: mapping.unitPrice,
            totalPrice: mapping.quantity * mapping.unitPrice,
          },
        });
      });
      created++;
      if (created % 50 === 0) {
        console.log(`  Progress: ${created} created...`);
      }
    } catch (err: any) {
      errors++;
      console.error(`  [ERR] Order #${order.id}: ${err.message}`);
    }
  }

  // 4. Summary
  console.log('\n' + '='.repeat(60));
  console.log('\nSummary:');
  console.log(`  Total orders found:  ${orders.length}`);
  console.log(`  ${dryRun ? 'Would create' : 'Created'}:      ${created}`);
  console.log(`  Skipped (unmatched): ${skipped}`);
  if (errors > 0) {
    console.log(`  Errors:              ${errors}`);
  }
  if (unmatchedAmounts.length > 0) {
    console.log(`  Unmatched amounts:   ${unmatchedAmounts.join(', ')}`);
  }

  if (dryRun) {
    console.log('\nThis was a DRY RUN. No changes were made.');
    console.log('Run with --execute to create the OrderItem records.\n');
  } else {
    console.log('\nDone. OrderItems have been created.\n');
  }
}

// Parse CLI args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const execute = args.includes('--execute');

if (!dryRun && !execute) {
  console.error('\nError: You must specify either --dry-run or --execute\n');
  console.log('Usage:');
  console.log('  npm run backfill:order-items -- --dry-run   # Preview changes');
  console.log('  npm run backfill:order-items -- --execute   # Actually create entries\n');
  process.exit(1);
}

main(dryRun)
  .catch((e) => {
    console.error('\nFatal error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
