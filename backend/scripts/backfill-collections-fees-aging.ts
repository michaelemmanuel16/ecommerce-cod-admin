import { PrismaClient } from '@prisma/client';
import { assertNotProduction, hasFlag, option } from './lib/scriptArgs';
import * as Money from '../src/utils/money';
import {
  DEFAULT_FEE_SINCE, agingCard, applyDraftReconcile, applyFeeStamps, cashHeldCheck, ledgerSnapshot, planDraftReconcile, planFeeStamps,
} from '../src/services/collectionsBackfillService';

// M5-T30 (COD-52, F-906, F-931, F-936). Reconciles old draft collections from app data only, stamps delivery fees on
// outcomes since --since (default 2026-10-01), and prints the aging card and cash held per partner before and after.
// A draft is reconciled only when the partner's recorded deposits cover it; otherwise it is true unpaid cash and stays.
// August and September ledger rows are never written (D5); the script compares them before and after and fails on any change.
// Always prints counts and sums first. Dry run by default (writes nothing). Idempotent: a second --apply changes nothing.
// Flags: --apply (write), --tenant <id> (one tenant), --since YYYY-MM-DD (fee start), --allow-production (needed when NODE_ENV=production).
const prisma = new PrismaClient();
const apply = hasFlag('--apply');
const onlyTenant = option('--tenant');
const since = option('--since') ?? DEFAULT_FEE_SINCE;

async function report(tenantId: string, label: string) {
  const card = await agingCard(tenantId);
  console.log(`  aging ${label}: ${card.total.orders} unpaid orders, ${card.total.amount} (net of delivery fee); buckets ${card.buckets.map((b) => `${b.key}=${b.orders}/${b.amount}`).join(' ')}`);
  for (const r of await cashHeldCheck(tenantId)) {
    console.log(
      `  cash held ${label}, partner ${r.agentId}: collected ${Money.toApi(r.collected)} (fees inside ${Money.toApi(r.fees)}), deposits ${Money.toApi(r.deposits)}, ` +
        `expected ${Money.toApi(r.expected)}, held ${Money.toApi(r.held)}, diff ${Money.toApi(r.diff)} ${r.withinLimit ? 'within limit' : 'OUTSIDE LIMIT'}`,
    );
  }
}

async function main() {
  if (!assertNotProduction()) return;
  const tenants = await prisma.tenant.findMany({ where: onlyTenant ? { id: onlyTenant } : {}, select: { id: true, slug: true }, orderBy: { slug: 'asc' } });
  console.log(apply ? 'APPLY' : 'DRY RUN (nothing is written)');
  console.log(`fees since ${since}`);

  for (const tenant of tenants) {
    const drafts = await planDraftReconcile(tenant.id);
    const fees = await planFeeStamps(tenant.id, since);
    if (drafts.drafts.count === 0 && fees.rows.length === 0 && fees.noRule === 0) continue;
    const ledgerBefore = await ledgerSnapshot(tenant.id);
    console.log(`tenant ${tenant.slug} (${tenant.id}):`);
    console.log(`  draft collections: ${drafts.drafts.count}, ${Money.toApi(drafts.drafts.amount)}`);
    console.log(`    on delivered orders (true unpaid before): ${drafts.delivered.count}, ${Money.toApi(drafts.delivered.amount)}`);
    console.log(`    not on a delivered order (left alone): ${drafts.notDelivered.count}, ${Money.toApi(drafts.notDelivered.amount)}`);
    console.log(`    covered by recorded deposits (would reconcile): ${drafts.reconcile.length}, ${Money.toApi(drafts.reconcileAmount)}`);
    console.log(`  fees to stamp: ${fees.rows.length} orders, ${Money.toApi(fees.total)}; no fee rule (left alone): ${fees.noRule}; no history row (left alone): ${fees.noHistory}`);
    console.log(`  ledger before: ${ledgerBefore.map((m) => `${m.month} ${m.entries} entries, ${m.lines} lines, debit ${m.debit}`).join('; ')}`);
    await report(tenant.id, 'before');
    if (!apply) continue;

    const reconciled = await applyDraftReconcile(tenant.id, drafts);
    const stamped = await applyFeeStamps(tenant.id, fees);
    console.log(`  wrote: ${reconciled} collections reconciled, ${stamped.stamped} fees stamped (${Money.toApi(stamped.total)})`);
    const after = await planDraftReconcile(tenant.id);
    console.log(`  draft collections now: ${after.drafts.count}, ${Money.toApi(after.drafts.amount)}; on delivered orders ${after.delivered.count}, ${Money.toApi(after.delivered.amount)}`);
    await report(tenant.id, 'after');
    const ledgerAfter = await ledgerSnapshot(tenant.id);
    const same = JSON.stringify(ledgerBefore) === JSON.stringify(ledgerAfter);
    console.log(`  ledger after:  ${ledgerAfter.map((m) => `${m.month} ${m.entries} entries, ${m.lines} lines, debit ${m.debit}`).join('; ')} -> ${same ? 'UNCHANGED' : 'CHANGED'}`);
    if (!same) process.exitCode = 1;
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
