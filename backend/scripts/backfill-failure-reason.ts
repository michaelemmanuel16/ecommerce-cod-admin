import { PrismaClient } from '@prisma/client';
import { assertNotProduction, hasFlag, option } from './lib/scriptArgs';
import { backfillFailureReasons, ReasonCounts } from '../src/services/failureReasonBackfill';

// M4-T18 (F-705). Fills Order.failureReason for failed_delivery and returned orders that have none, from the free text
// they carry (history note and metadata, Delivery.notes). Obvious words map to the FailureReason list; the rest is "other".
// Idempotent: only orders with no reason are read, so a second run changes 0 orders. One run per tenant, inside its context.
// Writes by default. Flags: --dry-run (print the counts per reason, write nothing), --tenant <id> (one tenant only),
// --allow-production (needed when NODE_ENV=production).
const prisma = new PrismaClient();
const dryRun = hasFlag('--dry-run');
const onlyTenant = option('--tenant');

async function main() {
  if (!assertNotProduction()) return;
  const tenants = await prisma.tenant.findMany({ where: onlyTenant ? { id: onlyTenant } : {}, select: { id: true, slug: true }, orderBy: { slug: 'asc' } });
  console.log(dryRun ? 'DRY RUN (nothing is written)' : 'APPLY');

  const total: ReasonCounts = { not_reachable: 0, refused: 0, wrong_address: 0, rescheduled: 0, other: 0 };
  let orders = 0;
  for (const tenant of tenants) {
    const r = await backfillFailureReasons(tenant.id, { dryRun });
    if (r.orders === 0) continue;
    orders += r.orders;
    for (const key of Object.keys(total) as Array<keyof ReasonCounts>) total[key] += r.counts[key];
    console.log(`tenant ${tenant.slug}: ${r.orders} orders ${dryRun ? 'would be filled' : 'filled'}`, r.counts);
  }
  console.log(`total: ${orders} orders ${dryRun ? 'would be filled' : 'filled'}`);
  for (const [reason, count] of Object.entries(total)) console.log(`  ${reason}: ${count}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
