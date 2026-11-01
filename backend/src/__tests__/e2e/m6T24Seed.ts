/**
 * M6-T24: seeds one tenant with an Owner for the invite and target E2E flows, and removes it again.
 *   ts-node --transpile-only src/__tests__/e2e/m6T24Seed.ts seed            prints {"tenantId","email","password"}
 *   ts-node --transpile-only src/__tests__/e2e/m6T24Seed.ts cleanup <id>    deletes every row of that tenant
 *   ts-node --transpile-only src/__tests__/e2e/m6T24Seed.ts cleanup-all     deletes every tenant this script seeded (a killed run)
 * Run from backend/ with DATABASE_URL set to the test database; scripts/e2e-m6-t24.sh does both.
 */
import bcrypt from 'bcrypt';
import { prismaBase } from '../../utils/prisma';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { deleteTenantRows } from '../integration/helpers/twoTenants';

const PASSWORD = 'Passw0rd!owner';

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'seed') {
    const stamp = Date.now();
    const tenant = await prismaBase.tenant.create({ data: { name: `E2E M6 ${stamp}`, slug: `e2e-m6-${stamp}`, currency: 'GHS' } });
    const email = `e2e-owner-${stamp}@codadmin.test`;
    const owner = await prismaBase.user.create({
      data: {
        email, password: await bcrypt.hash(PASSWORD, 10), firstName: 'Esi', lastName: 'Owner', role: 'super_admin', tenantId: tenant.id,
        preferences: { onboardingCompleted: true },
      },
    });
    await seedTenantDefaults(tenant.id, owner.id);
    console.log(JSON.stringify({ tenantId: tenant.id, email, password: PASSWORD }));
  } else if (cmd === 'cleanup' && arg) {
    await deleteTenantRows([arg]);
  } else if (cmd === 'cleanup-all') {
    const left = await prismaBase.tenant.findMany({ where: { slug: { startsWith: 'e2e-m6-' } }, select: { id: true } });
    if (left.length) await deleteTenantRows(left.map((t) => t.id));
    console.log(`removed ${left.length}`);
  } else {
    throw new Error('usage: seed | cleanup <tenantId> | cleanup-all');
  }
}

main().then(() => prismaBase.$disconnect()).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
