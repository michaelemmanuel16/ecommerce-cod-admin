import { PrismaClient } from '@prisma/client';
import { assertNotProduction, hasFlag } from './lib/scriptArgs';

// M1-T23 (COD-11, D15). Seeds the canonical NUMBERS.md fixture into ONE tenant, slug `fixture-numbers`.
// Re-run = delete that tenant's rows and build them again (same counts, same hash). No other tenant is read or written.
// Refuses when NODE_ENV=production (no override) and when the DATABASE_URL host is not localhost, 127.0.0.1 or a
// docker service name (a name with no dot). Default writes; `--dry-run` prints the plan and touches no database.
// Run: npm run seed:fixture [-- --dry-run]

const dryRun = hasFlag('--dry-run');

function databaseHost(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return new URL(url).hostname;
}

/** localhost, 127.0.0.1, ::1 or a docker service name (no dot, for example `postgres`). */
const isLocalHost = (host: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host) || (host.length > 0 && !host.includes('.'));

async function main() {
  // The standard guard first (it lets --allow-production through), then the unconditional one: a seed never runs in production.
  if (!assertNotProduction()) return;
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to run with NODE_ENV=production.');
    process.exitCode = 1;
    return;
  }

  // Loaded after the guards so a refused run opens no connection.
  const fixture = await import('../src/__tests__/fixtures/numbersFixture');

  if (dryRun) {
    console.log(`Dry run: nothing is written. Tenant slug: ${fixture.FIXTURE_SLUG}`);
    console.log(JSON.stringify(fixture.summarizePlan(fixture.buildFixturePlan()), null, 2));
    return;
  }

  const host = databaseHost();
  console.log(`Database host: ${host}`);
  if (!isLocalHost(host)) {
    console.error(`Refusing to seed: host "${host}" is not localhost, 127.0.0.1 or a docker service name.`);
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const result = await fixture.seedFixture(prisma, { log: (line) => console.log(line) });
    console.log(JSON.stringify(await fixture.fixtureCounts(prisma, result.tenantId), null, 2));
    console.log(`Tenant ${fixture.FIXTURE_SLUG} (${result.tenantId}): ${result.orders} orders, delivered revenue GH₵${result.deliveredRevenue}`);
    console.log(`History: ${result.historyOrders} delivered orders January to September, ${result.expenses} expenses`);
    console.log(`Hash: ${result.hash}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
