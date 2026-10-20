/**
 * Backfill: seed the default EmailTemplate rows for every existing tenant.
 * Idempotent (skipDuplicates), safe to re-run — so until new-tenant auto-provisioning
 * lands (deferred follow-up, MAN-78 scope decision), re-running this picks up any
 * tenants created since the last run.
 *
 * Run: npx ts-node src/scripts/backfillEmailTemplates.ts
 */
import prisma from '../utils/prisma';
import { forEachTenant } from '../utils/tenantLoop';
import { seedDefaultEmailTemplates } from '../services/emailTemplateService';

async function main() {
  console.log('Seeding default email templates for every tenant...');

  let inserted = 0;
  // forEachTenant reads the tenant list unscoped (withoutTenant) and runs each seed inside its tenant
  await forEachTenant('Email template backfill', async (tenantId) => {
    const count = await seedDefaultEmailTemplates(tenantId);
    inserted += count;
    console.log(`  ${tenantId}: +${count}`);
  });

  console.log(`Done. Inserted ${inserted} row(s) total.`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
