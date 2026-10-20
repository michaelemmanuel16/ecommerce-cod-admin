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
