/**
 * Backfill: fill the town (Customer.area, Order.deliveryArea) on old rows from their address (COD-138).
 *
 * Targets: customers whose area is empty or equal to their state; orders whose delivery_area is empty or
 * equal to their delivery_state. The address text is matched against the town list of the row's own state.
 * Writes only area / delivery_area. Idempotent: a second run changes 0 rows.
 *
 * Dry run (default) prints counts per tenant and 20 sample matches; it writes nothing.
 * Run: npx ts-node src/scripts/backfillTowns.ts [--apply] [--tenant <id>]
 */
import { getTowns } from '../services/locationService';
import { baseState } from '../utils/regions';

const BATCH = 500;

const norm = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();
export { baseState };

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The town named in a text: whole word, case-insensitive, longest name first. When two different towns
 * appear, the one that comes first in the text wins.
 */
export function findTown(text: string, towns: string[]): string | null {
  let best: { town: string; index: number } | null = null;
  for (const town of [...towns].sort((a, b) => b.length - a.length)) {
    const m = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(town).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'iu').exec(text);
    // Strict "<": at the same position the longer name (tried first) stays.
    if (m && (!best || m.index < best.index)) best = { town, index: m.index };
  }
  return best ? best.town : null;
}

/**
 * The new value for a row's town, or undefined to leave it alone.
 * A region-only value with no town in the address becomes '' (the state is not a town).
 */
export function planTown(
  current: string | null | undefined,
  state: string | null | undefined,
  text: string,
  townsOf: (state: string) => string[],
): string | undefined {
  const cur = norm(current);
  const isTarget = cur === '' || cur === norm(state) || cur === norm(baseState(state));
  if (!isTarget) return undefined;
  const found = findTown(text, townsOf(baseState(state)));
  if (found) return found === (current ?? '') ? undefined : found;
  return cur === '' ? undefined : '';
}

type Row = { id: number; area: string | null; state: string | null; text: string };
type Change = { id: number; from: string | null; to: string; state: string | null; text: string };

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const onlyTenant = args.includes('--tenant') ? args[args.indexOf('--tenant') + 1] : undefined;

  // Loaded here so importing findTown / planTown in a test does not open a database client.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { prismaBase } = require('../utils/prisma') as typeof import('../utils/prisma');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { countryCodeOfTenant } = require('../services/locationService') as typeof import('../services/locationService');

  console.log(apply ? 'APPLY: rows will be written.' : 'DRY RUN: nothing is written. Add --apply to write.');
  const tenants = await prismaBase.tenant.findMany({ where: onlyTenant ? { id: onlyTenant } : {}, select: { id: true, name: true }, orderBy: { name: 'asc' } });
  const samples: string[] = [];
  const total = { customers: 0, orders: 0, found: 0, cleared: 0 };

  type Target = { label: string; table: 'customers' | 'orders'; col: 'area' | 'delivery_area'; stateCol: string; textSql: string };
  const targets: Target[] = [
    { label: 'customers', table: 'customers', col: 'area', stateCol: 'state', textSql: `concat_ws(' ', address, landmark)` },
    { label: 'orders', table: 'orders', col: 'delivery_area', stateCol: 'delivery_state', textSql: `coalesce(delivery_address, '')` },
  ];

  for (const tenant of tenants) {
    const country = await countryCodeOfTenant(tenant.id);
    const townsOf = (state: string): string[] => getTowns(country, state);
    const line: string[] = [];
    for (const t of targets) {
      let lastId = 0;
      let found = 0;
      let cleared = 0;
      for (;;) {
        const rows = await prismaBase.$queryRawUnsafe<Row[]>(
          `SELECT id, ${t.col} AS area, ${t.stateCol} AS state, ${t.textSql} AS text FROM ${t.table}
           WHERE tenant_id = $1 AND id > $2
             AND (coalesce(${t.col}, '') = '' OR lower(trim(${t.col})) = lower(trim(coalesce(${t.stateCol}, '')))
                  OR lower(trim(${t.col})) = lower(trim(regexp_replace(coalesce(${t.stateCol}, ''), '\\s*\\(.*\\)\\s*$', ''))))
           ORDER BY id LIMIT ${BATCH}`,
          tenant.id,
          lastId,
        );
        if (!rows.length) break;
        lastId = rows[rows.length - 1].id;
        const changes: Change[] = [];
        for (const r of rows) {
          const to = planTown(r.area, r.state, r.text ?? '', townsOf);
          if (to !== undefined) changes.push({ id: r.id, from: r.area, to, state: r.state, text: r.text ?? '' });
        }
        for (const c of changes) {
          if (c.to === '') cleared++;
          else found++;
          if (samples.length < 20 && c.to !== '') samples.push(`${tenant.name} | ${t.label} #${c.id} | ${c.state} | "${c.text.slice(0, 60)}" -> ${c.to}`);
        }
        if (apply && changes.length) {
          // One transaction per batch; one UPDATE per distinct new value.
          const byValue = new Map<string, number[]>();
          for (const c of changes) byValue.set(c.to, [...(byValue.get(c.to) ?? []), c.id]);
          await prismaBase.$transaction(
            [...byValue.entries()].map(([value, ids]) =>
              prismaBase.$executeRawUnsafe(`UPDATE ${t.table} SET ${t.col} = $1 WHERE tenant_id = $2 AND id = ANY($3::int[])`, value, tenant.id, ids),
            ),
          );
        }
      }
      line.push(`${t.label}: ${found} get a town, ${cleared} cleared to ''`);
      total[t.table] += found + cleared;
      total.found += found;
      total.cleared += cleared;
    }
    console.log(`${tenant.name} (${tenant.id}, ${country}): ${line.join(' | ')}`);
  }

  console.log('\nSample matches (up to 20):');
  samples.forEach((s) => console.log(`  ${s}`));
  console.log(`\nTotal: ${total.found} towns ${apply ? 'written' : 'would be written'}, ${total.cleared} region values ${apply ? 'cleared' : 'would be cleared'} to ''.`);
  await prismaBase.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  });
}
