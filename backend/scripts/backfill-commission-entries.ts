import { PrismaClient } from '@prisma/client';
import { assertNotProduction, hasFlag, option } from './lib/scriptArgs';
import * as Money from '../src/utils/money';
import { applyCommissionBackfill, commissionLedgerCheck, planCommissionBackfill } from '../src/services/commissionBackfillService';

// M5-T18 (COD-51, F-914). Turns every delivered order with commission_paid = false (and a confirming rep with a rate) into one
// `earned` CommissionEntry of kind base. An old order whose delivery journal entry already booked DR 5050 / CR 2020 keeps that
// amount and that entry (nothing posts twice); an order with no such line posts its own DR 5050 / CR 2020 at the rep's rate.
// Always prints the entry count and total per tenant BEFORE it writes anything. Idempotent: an order with a live base entry is skipped.
// Dry run by default (writes nothing). Flags: --apply (write), --tenant <id> (one tenant only), --allow-production (needed when NODE_ENV=production).
const prisma = new PrismaClient();
const apply = hasFlag('--apply');
const onlyTenant = option('--tenant');

async function main() {
  if (!assertNotProduction()) return;
  const tenants = await prisma.tenant.findMany({ where: onlyTenant ? { id: onlyTenant } : {}, select: { id: true, slug: true }, orderBy: { slug: 'asc' } });
  console.log(apply ? 'APPLY' : 'DRY RUN (nothing is written)');

  let count = 0;
  let total = Money.ZERO;
  for (const tenant of tenants) {
    const plan = await planCommissionBackfill(tenant.id);
    const check = await commissionLedgerCheck(tenant.id);
    console.log(
      `tenant ${tenant.slug}: ${plan.rows.length} entries, total ${Money.toApi(plan.total)} ` +
        `(${plan.adopted} keep the booked delivery entry, ${plan.rows.length - plan.adopted} post their own). ` +
        `2020 now ${Money.toApi(check.payableBalance)}, open entries now ${Money.toApi(check.openEntries)}`,
    );
    count += plan.rows.length;
    total = Money.add(total, plan.total);
    if (!apply || plan.rows.length === 0) continue;

    const done = await applyCommissionBackfill(tenant.id, plan);
    const after = await commissionLedgerCheck(tenant.id);
    console.log(
      `  wrote ${done.written} entries, total ${Money.toApi(done.total)}. ` +
        `2020 ${Money.toApi(after.payableBalance)}, open entries ${Money.toApi(after.openEntries)}, difference ${Money.toApi(after.difference)}`,
    );
  }
  console.log(`total: ${count} entries, ${Money.toApi(total)} ${apply ? 'processed' : 'would be written'}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
