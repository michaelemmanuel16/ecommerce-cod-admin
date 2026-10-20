import { PrismaClient } from '@prisma/client';
import { assertNotProduction, groupByTenant, hasFlag } from './lib/scriptArgs';

// M1-T07 (COD-9). Sets orders.delivery_date for old digital_delivered orders that have none.
// The revenue date of a digital order is the payment time (F-901). Order has no paid-at column,
// so the date comes from, in this order:
//   1. the first OrderHistory row with status digital_delivered (written right after settlement),
//   2. the paid payment Transaction of the order.
// An order with neither stays empty and is counted as unresolved. Never guessed.
// Idempotent: only rows with a null delivery_date are touched. Per tenant. Dry run by default (writes nothing); pass --apply to write.
// Plain PrismaClient on purpose: no tenant extension, so every tenant is visible; rows are grouped by tenant_id.
// Refuses to run when NODE_ENV=production unless --allow-production.
const prisma = new PrismaClient();
const dryRun = !hasFlag('--apply');

async function main() {
  if (!assertNotProduction()) return;
  console.log(dryRun ? 'MODE: dry run (no writes; pass --apply to write)' : 'MODE: apply (writes)');

  const orders = await prisma.order.findMany({
    where: { status: 'digital_delivered', deliveryDate: null },
    select: { id: true, tenantId: true },
    orderBy: { id: 'asc' },
  });

  let totalFilled = 0;
  let totalUnresolved = 0;
  for (const [tenantId, tenantOrders] of groupByTenant(orders)) {
    const ids = tenantOrders.map((o) => o.id);
    const [history, payments] = await Promise.all([
      prisma.orderHistory.findMany({
        where: { orderId: { in: ids }, status: 'digital_delivered' },
        select: { orderId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.transaction.findMany({
        where: { orderId: { in: ids }, type: 'payment', status: 'paid' },
        select: { orderId: true, createdAt: true },
      }),
    ]);
    const paidAt = new Map<number, Date>();
    for (const p of payments) if (p.orderId != null) paidAt.set(p.orderId, p.createdAt);
    // History wins over the transaction; the first history row is the earliest because of the ordering.
    const firstHistory = new Map<number, Date>();
    for (const h of history) if (!firstHistory.has(h.orderId)) firstHistory.set(h.orderId, h.createdAt);

    let filled = 0;
    let unresolved = 0;
    for (const id of ids) {
      const date = firstHistory.get(id) ?? paidAt.get(id);
      if (!date) {
        unresolved++;
        continue;
      }
      if (!dryRun) await prisma.order.updateMany({ where: { id, deliveryDate: null }, data: { deliveryDate: date } });
      filled++;
    }
    console.log(`tenant ${tenantId ?? 'NULL'}: ${ids.length} without deliveryDate, ${dryRun ? 'would fill' : 'filled'} ${filled}, unresolved ${unresolved}`);
    totalFilled += filled;
    totalUnresolved += unresolved;
  }
  console.log(`Total: ${orders.length} without deliveryDate, ${dryRun ? 'would fill' : 'filled'} ${totalFilled}, unresolved ${totalUnresolved}`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
