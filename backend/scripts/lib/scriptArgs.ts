import { prismaBase } from '../../src/utils/prisma';

/**
 * Shared helpers for the one-off data scripts (backfills, normalizers): CLI flags,
 * the production guard and tenant grouping.
 */
export function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

/** Value after `--name`, or undefined when the flag is absent or last. */
export function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * Returns false (and sets exit code 1) when NODE_ENV=production and `--allow-production` is absent.
 * Call it first in main() and return when it is false.
 */
export function assertNotProduction(): boolean {
  if (process.env.NODE_ENV === 'production' && !hasFlag('--allow-production')) {
    console.error('Refusing to run with NODE_ENV=production. Pass --allow-production to override.');
    process.exitCode = 1;
    return false;
  }
  return true;
}

/** Groups rows by tenantId (null is its own group), keeping input order. */
export function groupByTenant<T extends { tenantId: string | null }>(rows: T[]): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>();
  for (const row of rows) {
    const group = groups.get(row.tenantId);
    if (group) group.push(row);
    else groups.set(row.tenantId, [row]);
  }
  return groups;
}

/**
 * The main() of a per-tenant data script: production guard, `--dry-run` and `--tenant <id>` flags, a banner, one try/catch per
 * tenant, exit code 1 when any tenant fails (or `fn` returns false), and the disconnect. An unknown `--tenant` is an error.
 * `fn` gets the tenant id and the dry-run flag; the tenants are read with the base client in id order.
 */
export async function runPerTenant(fn: (tenantId: string, dryRun: boolean) => Promise<boolean | void>): Promise<void> {
  try {
    if (!assertNotProduction()) return;
    const dryRun = hasFlag('--dry-run');
    const only = option('--tenant');
    const tenants = await prismaBase.tenant.findMany({ where: only ? { id: only } : undefined, select: { id: true }, orderBy: { id: 'asc' } });
    if (only && !tenants.length) {
      console.error(`Unknown tenant: ${only}`);
      process.exitCode = 1;
      return;
    }
    console.log(dryRun ? 'DRY RUN: nothing is written' : 'REAL RUN');
    for (const t of tenants) {
      try {
        if ((await fn(t.id, dryRun)) === false) process.exitCode = 1;
      } catch (e) {
        process.exitCode = 1;
        console.error(`Tenant ${t.id}: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await prismaBase.$disconnect();
  }
}
