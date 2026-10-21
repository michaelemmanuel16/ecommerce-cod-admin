import { PrismaClient, TargetScope } from '@prisma/client';
import { assertNotProduction, hasFlag, option } from './lib/scriptArgs';

// M3-T09 (COD-22, F-202). Writes the Target tree the Dashboard ladder reads, before the M6 wizard exists, from the
// numbers fixture (NUMBERS.md): the year North Star 1,800,000; quarters 360k / 420k / 480k / 540k; October to
// December 180,000 each; confirmation rate 70% and delivery success rate 60% for the year. Edit the TREE values below
// for the owner's real figures. The M6 editor replaces this script.
// Idempotent: a row is matched on tenant, scope, metric and period start (no role, no person) and updated in place,
// so a second run changes nothing. It never deletes. Dry run by default (prints what it would write).
// Flags: --tenant <id> (required), --year <YYYY> (default 2026), --apply (write), --allow-production (NODE_ENV=production).

const YEAR_TARGET = 1_800_000;
const QUARTER_TARGETS = [360_000, 420_000, 480_000, 540_000];
/** Month number (1-12) to its revenue target. */
const MONTH_TARGETS: Record<number, number> = { 10: 180_000, 11: 180_000, 12: 180_000 };
const CONFIRMATION_RATE = 70;
const DELIVERY_SUCCESS_RATE = 60;

interface TargetSpec {
  scope: TargetScope;
  metric: string;
  unit: string;
  periodStart: Date;
  periodEnd: Date;
  value: number;
  /** Key of the parent spec in the same tree. */
  parent?: string;
}

const utc = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day));
const specKey = (s: Pick<TargetSpec, 'scope' | 'metric' | 'periodStart'>) => `${s.scope}|${s.metric}|${s.periodStart.toISOString()}`;

/** The rows of the tree for one year, parents first. */
export function targetTree(year: number): TargetSpec[] {
  const yearSpec: TargetSpec = {
    scope: 'north_star', metric: 'revenue', unit: 'money', periodStart: utc(year, 1, 1), periodEnd: utc(year, 12, 31), value: YEAR_TARGET,
  };
  const specs: TargetSpec[] = [yearSpec];
  QUARTER_TARGETS.forEach((value, q) => {
    const quarter: TargetSpec = {
      scope: 'quarter', metric: 'revenue', unit: 'money', periodStart: utc(year, q * 3 + 1, 1), periodEnd: utc(year, q * 3 + 4, 0), value,
      parent: specKey(yearSpec),
    };
    specs.push(quarter);
    for (let m = q * 3 + 1; m <= q * 3 + 3; m++) {
      if (MONTH_TARGETS[m] === undefined) continue;
      specs.push({
        scope: 'month', metric: 'revenue', unit: 'money', periodStart: utc(year, m, 1), periodEnd: utc(year, m + 1, 0), value: MONTH_TARGETS[m],
        parent: specKey(quarter),
      });
    }
  });
  for (const [metric, value] of [['confirmation_rate', CONFIRMATION_RATE], ['delivery_success_rate', DELIVERY_SUCCESS_RATE]] as const) {
    specs.push({ scope: 'north_star', metric, unit: 'percent', periodStart: yearSpec.periodStart, periodEnd: yearSpec.periodEnd, value });
  }
  return specs;
}

/** Create or update the tree in one tenant. Returns how many rows were created and updated. */
export async function seedTargets(prisma: PrismaClient, tenantId: string, year: number, dryRun = false): Promise<{ created: number; updated: number; unchanged: number }> {
  const ids = new Map<string, number>();
  const result = { created: 0, updated: 0, unchanged: 0 };
  for (const spec of targetTree(year)) {
    const key = specKey(spec);
    const parentId = spec.parent ? ids.get(spec.parent) ?? null : null;
    const existing = await prisma.target.findFirst({
      where: { tenantId, scope: spec.scope, metric: spec.metric, periodStart: spec.periodStart, roleId: null, userId: null },
      orderBy: { id: 'asc' },
    });
    const data = { unit: spec.unit, periodEnd: spec.periodEnd, value: spec.value, parentId };
    if (!existing) {
      result.created += 1;
      if (!dryRun) ids.set(key, (await prisma.target.create({ data: { tenantId, scope: spec.scope, metric: spec.metric, periodStart: spec.periodStart, ...data } })).id);
      continue;
    }
    ids.set(key, existing.id);
    const same = existing.unit === data.unit && existing.periodEnd.getTime() === data.periodEnd.getTime()
      && Number(existing.value) === data.value && existing.parentId === data.parentId;
    if (same) { result.unchanged += 1; continue; }
    result.updated += 1;
    if (!dryRun) await prisma.target.update({ where: { id: existing.id }, data });
  }
  return result;
}

async function main() {
  if (!assertNotProduction()) return;
  const tenantId = option('--tenant');
  if (!tenantId) {
    console.error('Pass --tenant <id>. Optional: --year <YYYY>, --apply.');
    process.exitCode = 1;
    return;
  }
  const year = Number(option('--year') ?? 2026);
  const dryRun = !hasFlag('--apply');
  const prisma = new PrismaClient();
  try {
    console.log(dryRun ? 'DRY RUN (pass --apply to write)' : 'APPLY');
    const r = await seedTargets(prisma, tenantId, year, dryRun);
    console.log(`tenant ${tenantId}, ${year}: ${r.created} ${dryRun ? 'would be created' : 'created'}, ${r.updated} ${dryRun ? 'would change' : 'changed'}, ${r.unchanged} unchanged`);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
