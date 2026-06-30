/**
 * Backfill: seed the default EmailTemplate rows for every existing tenant.
 * Idempotent (skipDuplicates), safe to re-run — so until new-tenant auto-provisioning
 * lands (deferred follow-up, MAN-78 scope decision), re-running this picks up any
 * tenants created since the last run.
 *
 * Run: npx ts-node src/scripts/backfillEmailTemplates.ts
 */
import prisma from '../utils/prisma';
import { seedDefaultEmailTemplates } from '../services/emailTemplateService';

async function main() {
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  console.log(`Seeding default email templates for ${tenants.length} tenant(s)...`);

  let inserted = 0;
  for (const tenant of tenants) {
    const count = await seedDefaultEmailTemplates(tenant.id);
    inserted += count;
    console.log(`  ${tenant.name} (${tenant.id}): +${count}`);
  }

  console.log(`Done. Inserted ${inserted} row(s) total.`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
