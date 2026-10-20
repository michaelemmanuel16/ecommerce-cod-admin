import { Prisma, PrismaClient } from '@prisma/client';
import { TENANT_SCOPED_MODELS } from '../src/utils/prismaExtensions';

// M0-T13 (COD-4). Dry run by default; pass --apply to write.
// 1. Moves accounts with tenant_id NULL to the owner tenant (oldest createdAt),
//    only if that tenant has no account with the same code. A clash is reported
//    and both rows are left alone.
// 2. Prints the NULL-tenant row count of every tenant-scoped table.
// Plain PrismaClient on purpose: no tenant extension, so NULL rows are visible.
const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

async function main() {
  console.log(apply ? 'MODE: apply (writes)' : 'MODE: dry run (no writes, pass --apply to write)');

  const owner = await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } });
  if (!owner) {
    console.log('No tenants found. Nothing to do.');
    return;
  }
  console.log(`Owner tenant (oldest): ${owner.id} (${owner.name})`);

  const nullAccounts = await prisma.account.findMany({ where: { tenantId: null }, orderBy: { id: 'asc' } });
  console.log(`\nAccounts with tenant_id NULL: ${nullAccounts.length}`);
  let moved = 0;
  for (const acc of nullAccounts) {
    const clash = await prisma.account.findFirst({ where: { tenantId: owner.id, code: acc.code }, select: { id: true } });
    if (clash) {
      console.log(`  CLASH code ${acc.code} (id ${acc.id}): owner already has id ${clash.id}. Left both.`);
      continue;
    }
    console.log(`  ${apply ? 'move' : 'would move'} code ${acc.code} (id ${acc.id}, ${acc.name}) -> ${owner.id}`);
    if (apply) await prisma.account.update({ where: { id: acc.id }, data: { tenantId: owner.id } });
    moved++;
  }
  console.log(`Accounts ${apply ? 'moved' : 'that would move'}: ${moved}`);

  console.log('\nNULL tenant_id rows per tenant-scoped table:');
  const rows: { model: string; nullRows: number | string }[] = [];
  for (const model of [...TENANT_SCOPED_MODELS].sort()) {
    // A required tenantId column cannot hold NULL, and Prisma rejects the filter
    const field = Prisma.dmmf.datamodel.models.find((m) => m.name === model)?.fields.find((f) => f.name === 'tenantId');
    if (field?.isRequired) {
      rows.push({ model, nullRows: 'n/a (required)' });
      continue;
    }
    const delegate = (prisma as any)[model.charAt(0).toLowerCase() + model.slice(1)];
    rows.push({ model, nullRows: await delegate.count({ where: { tenantId: null } }) });
  }
  console.table(rows);
  console.log(`Models with NULL rows: ${rows.filter((r) => typeof r.nullRows === 'number' && r.nullRows > 0).map((r) => `${r.model}=${r.nullRows}`).join(', ') || 'none'}`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
