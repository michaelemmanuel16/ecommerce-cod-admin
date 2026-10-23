import { PrismaClient } from '@prisma/client';
import { assertNotProduction, hasFlag, option } from './lib/scriptArgs';
import { customerStatsService } from '../src/services/customerStatsService';

// M3-T03 (COD-22). Rebuilds Customer.totalOrders, deliveredOrders, refusedOrders, deliveredValue and lastOrderAt from the orders
// (customerStatsService.recompute rules, F-357). A customer whose stored values already match is not written.
// Idempotent: a second run changes 0 customers. Plain PrismaClient reads the tenant list; every tenant is visible.
// Dry run by default (writes nothing, prints how many customers would change).
// Flags: --apply (write), --tenant <id> (one tenant only), --allow-production (needed when NODE_ENV=production).
const prisma = new PrismaClient();
const dryRun = !hasFlag('--apply');
const onlyTenant = option('--tenant');

async function main() {
  if (!assertNotProduction()) return;
  const started = Date.now();
  const rows = await prisma.$queryRawUnsafe<Array<{ tenant_id: string | null }>>(
    `SELECT DISTINCT tenant_id FROM customers ORDER BY tenant_id`);
  const targets = rows.map((r) => r.tenant_id).filter((t) => !onlyTenant || t === onlyTenant);
  console.log(dryRun ? 'DRY RUN (pass --apply to write)' : 'APPLY');

  let customers = 0;
  let changed = 0;
  for (const tenantId of targets) {
    const r = await customerStatsService.recomputeTenant(tenantId, { dryRun });
    customers += r.customers;
    changed += r.changed;
    console.log(`tenant ${tenantId ?? 'NULL'}: ${r.customers} customers, ${r.changed} ${dryRun ? 'would change' : 'changed'}`);
  }
  const [t] = await prisma.$queryRawUnsafe<Array<{ delivered: number; refused: number; with_orders: number }>>(
    `SELECT COUNT(*) FILTER (WHERE delivered_orders > 0)::int AS delivered,
            COUNT(*) FILTER (WHERE refused_orders > 0)::int AS refused,
            COUNT(*) FILTER (WHERE total_orders > 0)::int AS with_orders
     FROM customers WHERE ($1::text IS NULL OR tenant_id = $1)`, onlyTenant ?? null);
  console.log(`total: ${customers} customers, ${changed} ${dryRun ? 'would change' : 'changed'}`);
  console.log(`stored now: ${t.with_orders} with orders, ${t.delivered} with a delivered order, ${t.refused} with a refused order`);
  console.log(`runtime: ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
