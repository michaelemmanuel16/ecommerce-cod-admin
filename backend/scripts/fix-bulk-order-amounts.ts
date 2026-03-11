/**
 * Fix bulk-imported orders where "Total Amount" was mistakenly used as unit price,
 * causing totalAmount = csvTotal × quantity instead of csvTotal.
 *
 * Identification: the stored unitPrice is GREATER than the product's list price,
 * meaning it cannot be a valid per-unit price — it must be a total amount.
 *
 * Example (wrong):  qty=2, unitPrice=450, total=900  → unitPrice(450) > product.price(250)
 * Example (correct): qty=2, unitPrice=225, total=450  → unitPrice(225) ≤ product.price(250)
 *
 * Fix: correct_total = storedUnitPrice, correct_unitPrice = storedUnitPrice / qty
 *
 * Use --live to apply changes (default is dry run).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixBulkOrderAmounts(dryRun = true) {
  console.log(`\n=== Fix Bulk Order Amounts (${dryRun ? 'DRY RUN' : 'LIVE'}) ===\n`);

  // Fetch bulk-imported orders with qty > 1, including product list price for comparison
  const orders = await prisma.order.findMany({
    where: {
      source: 'bulk_import',
      deletedAt: null,
      orderItems: { some: { quantity: { gt: 1 } } },
    },
    select: {
      id: true,
      totalAmount: true,
      subtotal: true,
      codAmount: true,
      orderItems: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          totalPrice: true,
          product: { select: { id: true, name: true, price: true } },
        },
      },
      customer: { select: { firstName: true, lastName: true, phoneNumber: true } },
    },
  });

  console.log(`Found ${orders.length} bulk-imported orders with qty > 1\n`);

  const toFix: Array<{
    orderId: number;
    itemId: number;
    correctTotal: number;
    correctUnitPrice: number;
    before: { unitPrice: number; total: number };
    customer: string;
    product: string;
    qty: number;
  }> = [];

  for (const order of orders) {
    for (const item of order.orderItems) {
      if (item.quantity <= 1) continue;

      const productListPrice = item.product?.price ?? 0;

      // If stored unitPrice > product list price, it cannot be a valid per-unit price —
      // it was the "Total Amount" column value incorrectly used as unit price.
      if (item.unitPrice > productListPrice) {
        const correctTotal = item.unitPrice;           // stored unitPrice IS the real total
        const correctUnitPrice = item.unitPrice / item.quantity;

        toFix.push({
          orderId: order.id,
          itemId: item.id,
          correctTotal,
          correctUnitPrice,
          before: { unitPrice: item.unitPrice, total: order.totalAmount },
          customer: `${order.customer?.firstName} ${order.customer?.lastName} (${order.customer?.phoneNumber})`,
          product: item.product?.name ?? 'Unknown',
          qty: item.quantity,
        });
      }
    }
  }

  if (toFix.length === 0) {
    console.log('No orders need fixing.');
    return;
  }

  console.log(`Orders to fix (${toFix.length}):\n`);
  for (const fix of toFix) {
    console.log(`  Order #${fix.orderId} — ${fix.customer}`);
    console.log(`    ${fix.product}: qty=${fix.qty}`);
    console.log(`    Before: unitPrice=${fix.before.unitPrice}, total=${fix.before.total}`);
    console.log(`    After:  unitPrice=${fix.correctUnitPrice.toFixed(2)}, total=${fix.correctTotal}\n`);
  }

  if (dryRun) {
    console.log(`DRY RUN — ${toFix.length} orders would be fixed. Re-run with --live to apply.`);
    return;
  }

  let fixed = 0;
  for (const fix of toFix) {
    await prisma.$transaction([
      prisma.order.update({
        where: { id: fix.orderId },
        data: {
          totalAmount: fix.correctTotal,
          subtotal: fix.correctTotal,
          codAmount: fix.correctTotal,
        },
      }),
      prisma.orderItem.update({
        where: { id: fix.itemId },
        data: {
          unitPrice: fix.correctUnitPrice,
          totalPrice: fix.correctTotal,
        },
      }),
    ]);
    fixed++;
  }

  console.log(`Fixed ${fixed} orders.`);
}

const isLive = process.argv.includes('--live');
fixBulkOrderAmounts(!isLive)
  .catch(console.error)
  .finally(() => prisma.$disconnect());
