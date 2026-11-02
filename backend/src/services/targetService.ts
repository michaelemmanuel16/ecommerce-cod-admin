import { Prisma, Target, TargetScope } from '@prisma/client';
import prisma, { prismaBase, type TransactionClient } from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { startOfUtcDay } from '../utils/startOfUtcDay';
import { fullName } from '../utils/nameUtils';
import logger from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import * as Money from '../utils/money';
import { auditService } from './auditService';
import { createNotification, findTenantAdmins } from './notificationService';
import { holderSelect, holderStatus, holderView } from './roleService';
import { failedDeliveryCalls, FAILED_CALLS_METRIC } from './kpi/daily';
import { DAY_MS, currentMonth, endOfDay, getStoreTimeZone, parseMonth, parseYmd, startOfDay, utcDate, utcDateOfYmd, ymdOfUtc } from './kpi/dates';

/**
 * M6-T07 (F-1100, F-1103): the target tree on the one `Target` table.
 *
 *   north_star (year) -> quarter -> month -> role -> person        and a separate `daily` activity target
 *
 * - A period is a string: '2026' (north_star), '2026-Q4' (quarter), '2026-10' (month, role, person). A daily target has a
 *   start day and stands until a newer one replaces it.
 * - Quarter and month values exist only as a whole set (`setChildren`): the quarters of a year add up to the North Star and
 *   the months of a quarter to the quarter, or the set is rejected with the difference. A role target sits under a month and a
 *   person target under a role target, same metric; together they may add up to less than the parent (what is left is the
 *   role pool) but never to more.
 * - A closed month locks itself and everything inside it. Other months of the same quarter can still be re-planned.
 * - A holder added mid-month gets no automatic share: until the owner sets one, the person shows "Set a target" (F-1102).
 * - Every write goes through `writeTarget`, one transaction that locks the parent row (and the month rows for the closed
 *   check), so two writes under one parent cannot both pass the sum check.
 */

export const SET_A_TARGET = 'Set a target';
export const NO_DATA_FOR_METRIC = 'No data for this metric';

/** The levels. A child sits under `scope` parents; `exact` children must add up to the parent, the others to at most. */
const CHILD: Partial<Record<TargetScope, { scope: TargetScope; name: string; exact: boolean }>> = {
  north_star: { scope: 'quarter', name: 'quarters', exact: true },
  quarter: { scope: 'month', name: 'months', exact: true },
  month: { scope: 'role', name: 'role targets', exact: false },
  role: { scope: 'person', name: 'person targets', exact: false },
};
const PARENT = Object.fromEntries(Object.entries(CHILD).map(([parent, c]) => [c.scope, parent as TargetScope])) as Partial<Record<TargetScope, TargetScope>>;
/** A daily target that is not replaced runs to this day. */
const OPEN_END = utcDate(2999, 12, 31);

export interface TargetInput {
  /** north_star, role, person or daily. Quarters and months are saved with `setChildren`. */
  scope: TargetScope;
  metric: string;
  unit: string;
  value: Money.MoneyInput;
  /** '2026' | '2026-10' for the tree; a start day 'YYYY-MM-DD' for daily (default today). */
  period?: string;
  /** Optional. Without one, a role/person target links to the parent that covers its period with the same metric. */
  parentId?: number;
  roleId?: number;
  userId?: number;
  /** 'manual' marks an owner edit (planned AOV, F-1113). A new row is 'auto'; an update keeps its source unless given. */
  source?: 'auto' | 'manual';
}

interface ChildInput { period: string; value: Money.MoneyInput }

type Db = Prisma.TransactionClient;
interface Row { scope: TargetScope; metric: string; unit: string; value: Money.Money; start: Date; end: Date; parentId?: number; roleId?: number; userId?: number; source?: string }

/** The whole tree of a year, 4 quarters of 3 months. `build` gets the existing quarter and month rows (read under lock) and returns the plan. */
interface YearPlanResult<E = undefined> { annual: Money.Money; quarters: Array<{ value: Money.Money; months: Money.Money[] }>; extra?: E }
type WriteOp =
  /** `alongside` rows are saved first in the same transaction (the planned AOV that goes with a tree). */
  | { kind: 'plan'; metric: string; unit: string; year: number; build: (existing: Target[]) => YearPlanResult<unknown>; alongside: Row[] }
  | { kind: 'save'; row: Row }
  | { kind: 'saveMany'; rows: Row[]; removeIds: number[] }
  | { kind: 'set'; parentId: number; children: Array<{ start: Date; end: Date; value: Money.Money }> }
  | { kind: 'delete'; id: number }
  | { kind: 'release'; roleId: number; userId: number; today: Date };

const bad = (period: string | undefined, scope: TargetScope) => new AppError(`Invalid period "${period}" for a ${scope} target`, 400, 'INVALID_PERIOD');

/** [start, end] of a period string for `scope`. */
export function periodBounds(scope: TargetScope, period?: string): { start: Date; end: Date } {
  if (scope === 'daily') {
    if (!period) return { start: startOfUtcDay(), end: OPEN_END };
    try { parseYmd(period); } catch { throw bad(period, scope); }
    return { start: utcDateOfYmd(period), end: OPEN_END };
  }
  if (scope === 'north_star') {
    if (!period || !/^\d{4}$/.test(period)) throw bad(period, scope);
    return { start: utcDate(Number(period), 1), end: utcDate(Number(period), 13, 0) };
  }
  if (scope === 'quarter') {
    const m = /^(\d{4})-Q([1-4])$/.exec(period ?? '');
    if (!m) throw bad(period, scope);
    const first = (Number(m[2]) - 1) * 3 + 1;
    return { start: utcDate(Number(m[1]), first), end: utcDate(Number(m[1]), first + 3, 0) };
  }
  const parsed = parseMonth(period ?? '');
  if (!parsed) throw bad(period, scope);
  return { start: utcDate(parsed.year, parsed.month), end: utcDate(parsed.year, parsed.month + 1, 0) };
}

// ---- Checks ---------------------------------------------------------------------------------------------------------

/** `sum` is what the children add up to. Exact levels must equal the parent; the others must not exceed it. */
export function assertSum(parentScope: TargetScope, sum: Money.Money, value: Money.Money) {
  const { name, exact } = CHILD[parentScope]!;
  if (exact ? sum.eq(value) : sum.lte(value)) return;
  const diff = Money.sub(sum, value);
  throw new AppError(
    `The ${name} add up to ${Money.toApi(sum)} but the ${parentScope.replace('_', ' ')} is ${Money.toApi(value)} `
    + `(${diff.gt(0) ? 'over' : 'short'} by ${Money.toApi(diff.abs())}). Difference: ${Money.toApi(diff.abs())}`,
    400, 'TARGET_SUM_MISMATCH',
  );
}

const CLOSED_MESSAGE = 'This month is closed and its targets cannot be edited';
const closedError = () => new AppError(CLOSED_MESSAGE, 409, 'MONTH_CLOSED');

const lock = (tx: Db, tenantId: string, ids: number[]) =>
  tx.$queryRaw`SELECT id FROM targets WHERE tenant_id = ${tenantId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;

/**
 * The closed month targets that touch [start, end]. The same query locks every month row it covers, so a month cannot be
 * closed while a write inside it is in flight.
 */
async function closedMonths(tx: Db, tenantId: string, start: Date, end: Date) {
  const rows = await tx.$queryRaw<Array<{ period_start: Date; period_end: Date; closed_at: Date | null }>>`
    SELECT period_start, period_end, closed_at FROM targets
    WHERE tenant_id = ${tenantId} AND scope::text = 'month' AND period_start <= ${end} AND period_end >= ${start}
    ORDER BY id FOR UPDATE`;
  return rows.filter((r) => r.closed_at !== null);
}
const monthClosed = async (tx: Db, tenantId: string, start: Date, end: Date) => (await closedMonths(tx, tenantId, start, end)).length > 0;

/** Targets that sit under `parent` and still count: a person target cut short by an unassign is released, so it does not. */
const underParent = (tenantId: string, parent: Pick<Target, 'id' | 'scope' | 'periodEnd' | 'metric'>): Prisma.TargetWhereInput => ({
  // Only children of the parent's own metric add up to it: a month of revenue holds role targets of orders and rates too.
  tenantId, parentId: parent.id, metric: parent.metric, ...(parent.scope === 'role' ? { periodEnd: { gte: parent.periodEnd } } : {}),
});

const childSum = async (tx: Db, tenantId: string, parent: Pick<Target, 'id' | 'scope' | 'periodEnd' | 'metric'>, exceptId?: number) => {
  const r = await tx.target.aggregate({
    where: { ...underParent(tenantId, parent), ...(exceptId ? { id: { not: exceptId } } : {}) }, _sum: { value: true }, _count: true,
  });
  return { sum: Money.orZero(r._sum.value), count: r._count };
};

/** The rows of one slot (scope, metric, owner) that start on any of `starts`. */
const findSlots = (tx: Db, tenantId: string, slot: Pick<Row, 'scope' | 'metric' | 'roleId' | 'userId'>, starts: Date[]) =>
  tx.target.findMany({
    where: { tenantId, scope: slot.scope, metric: slot.metric, roleId: slot.roleId ?? null, userId: slot.userId ?? null, periodStart: { in: starts } },
  });

// ---- The one write path ---------------------------------------------------------------------------------------------

/** The revenue month is the spine of every role target (M6-T15): a role target of orders or a rate sits under it. A person sits under the role target of the same metric. */
const SPINE_METRIC = 'revenue';
const SPINE_METRIC_OF = (row: Pick<Row, 'scope' | 'metric'>): string => (row.scope === 'role' ? SPINE_METRIC : row.metric);

/** The parent of a role or person target: the named one, else the one that covers the period on the spine metric. Locked. */
async function lockParent(tx: Db, tenantId: string, row: Row): Promise<Target | null> {
  const need = PARENT[row.scope];
  if (!need) return null;
  const found = await tx.target.findFirst({
    where: {
      tenantId,
      ...(row.parentId !== undefined
        ? { id: row.parentId }
        : { scope: need, metric: SPINE_METRIC_OF(row), periodStart: { lte: row.start }, periodEnd: { gte: row.start }, ...(row.scope === 'person' ? { roleId: row.roleId } : { roleId: null, userId: null }) }),
    },
  });
  if (!found) {
    if (row.parentId !== undefined) throw new AppError('Parent target not found', 404);
    throw new AppError(`A ${row.scope} target needs a ${need} target for this period and metric first`, 400, 'NO_PARENT');
  }
  if (found.scope !== need) throw new AppError(`A ${row.scope} target sits under a ${need} target`, 400, 'WRONG_PARENT_SCOPE');
  if (found.metric !== SPINE_METRIC_OF(row)) throw new AppError(`The parent target is "${found.metric}"; a child uses the same metric`, 400, 'METRIC_MISMATCH');
  const outside = row.start < found.periodStart || row.start > found.periodEnd
    || (ymdOfUtc(found.periodStart) !== ymdOfUtc(row.start) && (row.scope === 'role' || row.scope === 'person'));
  if (outside) throw new AppError('The child period is outside the parent period', 400, 'INVALID_PERIOD');
  if (row.scope === 'person' && found.roleId !== row.roleId) throw new AppError('The role target belongs to another role', 400, 'WRONG_PARENT_SCOPE');
  await lock(tx, tenantId, [found.id]);
  return tx.target.findFirstOrThrow({ where: { id: found.id } });
}

async function saveRow(tx: Db, tenantId: string, row: Row): Promise<Target> {
  // An id from the request must belong to this tenant: the base client does not add the filter.
  if (row.roleId !== undefined && (await tx.role.count({ where: { id: row.roleId, tenantId } })) === 0) throw new AppError('Role not found', 404);
  if (row.userId !== undefined && (await tx.user.count({ where: { id: row.userId, tenantId } })) === 0) throw new AppError('User not found', 404);
  if (row.scope === 'person' && (await tx.roleAssignment.count({ where: { tenantId, roleId: row.roleId, holderId: row.userId, toDate: null } })) === 0) {
    throw new AppError('This person does not hold the role', 400, 'NOT_A_HOLDER');
  }
  const parent = await lockParent(tx, tenantId, row);
  if (row.scope !== 'north_star' && (await monthClosed(tx, tenantId, row.start, row.scope === 'daily' ? row.start : row.end))) throw closedError();
  const [existing] = await findSlots(tx, tenantId, row, [row.start]);
  if (existing?.closedAt) throw closedError();

  // Counts and money add up under their parent; a rate does not, and a child of another metric is not compared with it.
  const adds = row.unit !== 'percent';
  if (parent && adds && parent.metric === row.metric) assertSum(parent.scope, Money.add((await childSum(tx, tenantId, parent, existing?.id)).sum, row.value), parent.value);
  if (existing && adds) {
    const kids = await childSum(tx, tenantId, existing);
    if (kids.count > 0) assertSum(existing.scope, kids.sum, row.value);
  }
  if (existing) return tx.target.update({ where: { id: existing.id }, data: { unit: row.unit, value: row.value, parentId: parent?.id ?? null, ...(row.source && { source: row.source }) } });

  if (row.scope === 'daily') {
    // A new start day ends the previous open target of the same metric and owner the day before.
    await tx.target.updateMany({
      where: { tenantId, scope: 'daily', metric: row.metric, userId: row.userId ?? null, periodStart: { lt: row.start }, periodEnd: { gte: row.start } },
      data: { periodEnd: new Date(row.start.getTime() - DAY_MS) },
    });
  }
  return tx.target.create({
    data: {
      tenantId, scope: row.scope, metric: row.metric, unit: row.unit, value: row.value, periodStart: row.start, periodEnd: row.end,
      parentId: parent?.id ?? null, roleId: row.roleId ?? null, userId: row.userId ?? null, source: row.source ?? 'auto',
    },
  });
}

/** A parent whose value moves must still cover what sits under it (exactly for quarters, at most for months and roles). */
async function assertCoversChildren(tx: Db, tenantId: string, moved: Map<number, { scope: TargetScope; metric: string; next: Money.Money }>) {
  if (moved.size === 0) return;
  const under = await tx.target.groupBy({ by: ['parentId', 'metric'], where: { tenantId, parentId: { in: [...moved.keys()] } }, _sum: { value: true } });
  for (const g of under) {
    const parent = moved.get(g.parentId!)!;
    if (g.metric === parent.metric) assertSum(parent.scope, Money.orZero(g._sum.value), parent.next);
  }
}

async function setRows(tx: Db, tenantId: string, op: Extract<WriteOp, { kind: 'set' }>): Promise<Target[]> {
  await lock(tx, tenantId, [op.parentId]);
  const parent = await tx.target.findFirst({ where: { id: op.parentId, tenantId } });
  if (!parent) throw new AppError('Parent target not found', 404);
  const level = CHILD[parent.scope];
  if (!level?.exact) throw new AppError('Only a North Star or quarter target takes a set of children', 400, 'WRONG_PARENT_SCOPE');
  if (parent.closedAt) throw closedError();
  if (parent.scope === 'quarter') await closedMonths(tx, tenantId, parent.periodStart, parent.periodEnd); // locks the month rows

  const starts = op.children.map((c) => c.start);
  if (new Set(starts.map((s) => s.getTime())).size !== starts.length) throw new AppError('A period is listed twice', 400, 'DUPLICATE_PERIOD');
  for (const c of op.children) {
    if (c.start < parent.periodStart || c.end > parent.periodEnd) throw new AppError(`${ymdOfUtc(c.start)} is outside the parent period`, 400, 'INVALID_PERIOD');
  }
  const existing = new Map((await tx.target.findMany({
    where: { tenantId, OR: [{ parentId: parent.id }, { scope: level.scope, metric: parent.metric, roleId: null, userId: null, periodStart: { in: starts } }] },
  })).map((r) => [r.id, r]));
  const slotOf = (start: Date) => [...existing.values()].find((r) => r.scope === level.scope && r.periodStart.getTime() === start.getTime() && r.userId === null && r.roleId === null);

  // A closed child keeps its value; the others may move as long as the whole set still adds up.
  const changes: Array<{ row?: Target; child: (typeof op.children)[number] }> = [];
  const values = new Map([...existing].map(([id, r]) => [id, r.value as Money.Money]));
  let fresh = Money.ZERO;
  for (const child of op.children) {
    const row = slotOf(child.start);
    if (row?.closedAt && !row.value.eq(child.value)) throw closedError();
    if (row) { values.set(row.id, child.value); if (!row.value.eq(child.value) || row.parentId !== parent.id) changes.push({ row, child }); }
    else { fresh = Money.add(fresh, child.value); changes.push({ child }); }
  }
  assertSum(parent.scope, Money.add(Money.sum(values.values()), fresh), parent.value);

  await assertCoversChildren(tx, tenantId, new Map(changes.filter((c) => c.row && !c.row.value.eq(c.child.value)).map((c) => [c.row!.id, { scope: c.row!.scope, metric: c.row!.metric, next: c.child.value }])));

  const saved: Target[] = [];
  for (const { row, child } of changes) {
    saved.push(row
      ? await tx.target.update({ where: { id: row.id }, data: { value: child.value, parentId: parent.id } })
      : await tx.target.create({
        data: { tenantId, scope: level.scope, metric: parent.metric, unit: parent.unit, value: child.value, periodStart: child.start, periodEnd: child.end, parentId: parent.id },
      }));
  }
  // Children that did not change are still part of the answer.
  const savedIds = new Set(saved.map((s) => s.id));
  const unchanged = op.children.map((c) => slotOf(c.start)).filter((r): r is Target => !!r && !savedIds.has(r.id));
  return [...saved, ...unchanged].sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
}

/**
 * Re-plan a whole year: the North Star, its 4 quarters and their 12 months in one transaction. A closed month must keep its
 * value (the plan the caller builds from `existing` is expected to keep it; this checks). Nothing is saved when a sum is off.
 */
async function planRows(tx: Db, tenantId: string, op: Extract<WriteOp, { kind: 'plan' }>) {
  for (const row of op.alongside) await saveRow(tx, tenantId, row);
  const year = periodBounds('north_star', String(op.year));
  const [northStar] = await findSlots(tx, tenantId, { scope: 'north_star', metric: op.metric }, [year.start]);
  if (northStar) await lock(tx, tenantId, [northStar.id]);
  if (northStar?.closedAt) throw closedError();
  const existing = await tx.target.findMany({
    where: { tenantId, metric: op.metric, roleId: null, userId: null, scope: { in: ['quarter', 'month'] }, periodStart: { gte: year.start, lte: year.end } },
    orderBy: { periodStart: 'asc' },
  });
  if (existing.length > 0) await lock(tx, tenantId, existing.map((r) => r.id));
  const plan = op.build(existing);
  plan.quarters.forEach((q) => assertSum('quarter', Money.sum(q.months), q.value));
  assertSum('north_star', Money.sum(plan.quarters.map((q) => q.value)), plan.annual);

  const at = (scope: TargetScope, start: Date) => existing.find((r) => r.scope === scope && r.periodStart.getTime() === start.getTime());
  const months = plan.quarters.flatMap((q, qi) => q.months.map((value, mi) => {
    const n = qi * 3 + mi + 1;
    return { qi, value, start: utcDate(op.year, n), end: utcDate(op.year, n + 1, 0) };
  }));
  // One pass: a closed month must keep its value; a month that moves must still hold the role targets under it.
  const moved = new Map<number, { scope: TargetScope; metric: string; next: Money.Money }>();
  for (const m of months) {
    const row = at('month', m.start);
    if (!row || row.value.eq(m.value)) continue;
    if (row.closedAt) throw closedError();
    moved.set(row.id, { scope: 'month', metric: row.metric, next: m.value });
  }
  await assertCoversChildren(tx, tenantId, moved);

  // Rows whose value, unit and parent did not change are left alone.
  const upsert = async (scope: TargetScope, start: Date, end: Date, value: Money.Money, parentId: number | null) => {
    const row = scope === 'north_star' ? northStar : at(scope, start);
    if (!row) return tx.target.create({ data: { tenantId, scope, metric: op.metric, unit: op.unit, value, periodStart: start, periodEnd: end, parentId } });
    if (row.value.eq(value) && row.unit === op.unit && row.parentId === parentId) return row;
    return tx.target.update({ where: { id: row.id }, data: { value, unit: op.unit, parentId } });
  };
  const ns = await upsert('north_star', year.start, year.end, plan.annual, null);
  const quarters: Target[] = [];
  for (let qi = 0; qi < 4; qi++) {
    const b = periodBounds('quarter', `${op.year}-Q${qi + 1}`);
    quarters.push(await upsert('quarter', b.start, b.end, plan.quarters[qi].value, ns.id));
  }
  const saved: Target[] = [];
  for (const m of months) saved.push(await upsert('month', m.start, m.end, m.value, quarters[m.qi].id));
  return { northStar: ns, quarters, months: saved, extra: plan.extra };
}

/** Several saves and removals in one transaction: all happen or none. */
async function saveMany(tx: Db, tenantId: string, op: Extract<WriteOp, { kind: 'saveMany' }>) {
  const saved: Target[] = [];
  for (const row of op.rows) saved.push(await saveRow(tx, tenantId, row));
  for (const id of op.removeIds) await deleteRow(tx, tenantId, id);
  return saved;
}

async function deleteRow(tx: Db, tenantId: string, id: number): Promise<void> {
  const target = await tx.target.findFirst({ where: { id, tenantId } });
  if (!target) throw new AppError('Target not found', 404);
  if (target.scope === 'quarter' || target.scope === 'month') throw new AppError('A quarter or month is changed with setChildren, not removed', 409, 'SET_ONLY');
  if (target.parentId) await lock(tx, tenantId, [target.parentId]);
  if (target.closedAt || (target.scope !== 'north_star' && (await monthClosed(tx, tenantId, target.periodStart, target.scope === 'daily' ? target.periodStart : target.periodEnd)))) throw closedError();
  if ((await tx.target.count({ where: { tenantId, parentId: id } })) > 0) throw new AppError('Remove the targets under it first', 409, 'HAS_CHILDREN');
  await tx.target.delete({ where: { id } });
}

/**
 * A person left the role: future-month person targets are removed; the current one stays for the history with its period cut
 * to the day before `today`, so it no longer counts (the amount is back in the role pool). Rows in a closed month stay.
 */
async function releaseRows(tx: Db, tenantId: string, op: Extract<WriteOp, { kind: 'release' }>) {
  const rows = await tx.target.findMany({
    where: { tenantId, scope: 'person', roleId: op.roleId, userId: op.userId, closedAt: null, periodEnd: { gte: op.today } },
    orderBy: { periodStart: 'asc' },
  });
  if (rows.length === 0) return [];
  await lock(tx, tenantId, rows.map((r) => r.id));
  const closed = await closedMonths(tx, tenantId, rows[0].periodStart, rows[rows.length - 1].periodEnd);
  const open = rows.filter((r) => !closed.some((m) => m.period_start <= r.periodEnd && m.period_end >= r.periodStart));
  const drop = open.filter((r) => r.periodStart >= op.today);
  const cut = open.filter((r) => r.periodStart < op.today);
  if (drop.length > 0) await tx.target.deleteMany({ where: { id: { in: drop.map((r) => r.id) } } });
  if (cut.length > 0) await tx.target.updateMany({ where: { id: { in: cut.map((r) => r.id) } }, data: { periodEnd: new Date(op.today.getTime() - DAY_MS) } });
  return open;
}

/** The only function that writes `Target` rows. */
async function writeTarget(tx: Db, tenantId: string, op: WriteOp) {
  switch (op.kind) {
    case 'save': return saveRow(tx, tenantId, op.row);
    case 'saveMany': return saveMany(tx, tenantId, op);
    case 'set': return setRows(tx, tenantId, op);
    case 'plan': return planRows(tx, tenantId, op);
    case 'delete': return deleteRow(tx, tenantId, op.id);
    case 'release': return releaseRows(tx, tenantId, op);
  }
}

const run = <T extends WriteOp>(op: T) => {
  const tenantId = resolveTenantId();
  // The un-extended client: every query inside names the tenant.
  return prismaBase.$transaction((tx) => writeTarget(tx, tenantId, op));
};

// ---- Public writes --------------------------------------------------------------------------------------------------

/** The checked row of an input, or 400. A quarter or month is never a single row: it goes through its set. */
function toRow(input: TargetInput): Row {
  const { scope } = input;
  if (scope === 'quarter' || scope === 'month') {
    throw new AppError(`A ${scope} target is saved with its quarter or year as a set: use setChildren on the ${PARENT[scope]!.replace('_', ' ')} target`, 400, 'SET_ONLY');
  }
  if (!input.metric?.trim() || !input.unit?.trim()) throw new AppError('A target needs a metric and a unit', 400);
  const value = Money.tryParse(input.value);
  if (value === null || value.lt(0)) throw new AppError('A target value must be a number of 0 or more', 400);
  if ((scope === 'role' || scope === 'person') && !input.roleId) throw new AppError(`A ${scope} target needs a role`, 400);
  if (scope === 'person' && !input.userId) throw new AppError('A person target needs a person', 400);
  if (scope === 'north_star' && (input.roleId || input.userId)) throw new AppError('A North Star target has no role or person', 400);
  const { start, end } = periodBounds(scope, input.period);
  return { scope, metric: input.metric, unit: input.unit, value, start, end, parentId: input.parentId, roleId: input.roleId, userId: input.userId, source: input.source };
}

/** Save a North Star, role, person or daily target (create, or update the row for the same scope, metric, period and owner). */
export async function saveTarget(input: TargetInput): Promise<Target> {
  return run({ kind: 'save', row: toRow(input) }) as Promise<Target>;
}

/** Save several targets and remove some others in one transaction (the driver targets). */
export async function saveTargets(inputs: TargetInput[], removeIds: number[] = []): Promise<Target[]> {
  return run({ kind: 'saveMany', rows: inputs.map(toRow), removeIds }) as Promise<Target[]>;
}

/**
 * Save the whole set of children of a North Star (its quarters) or quarter (its months). The set, with any child of the parent
 * that is not listed, must add up to the parent exactly, or nothing is saved and the difference is in the message. A closed
 * month keeps its value; the others can move. Returns the children.
 */
export async function setChildren(parentId: number, children: ChildInput[]): Promise<Target[]> {
  const parent = await prisma.target.findFirst({ where: { id: parentId }, select: { scope: true } });
  if (!parent) throw new AppError('Parent target not found', 404);
  const childScope = CHILD[parent.scope]?.scope;
  if (!childScope || !CHILD[parent.scope]!.exact) throw new AppError('Only a North Star or quarter target takes a set of children', 400, 'WRONG_PARENT_SCOPE');
  const planned = children.map((c) => {
    const value = Money.tryParse(c.value);
    if (value === null || value.lt(0)) throw new AppError('A target value must be a number of 0 or more', 400);
    return { ...periodBounds(childScope, c.period), value };
  });
  return run({ kind: 'set', parentId, children: planned }) as Promise<Target[]>;
}

/**
 * Create or re-plan the tree of one year in one transaction (the North Star service builds the numbers). `build` is given the
 * existing quarter and month rows and returns the new plan with any `extra` to hand back. `alongside` targets are saved first,
 * in the same transaction.
 */
export async function replanYear<E>(
  metric: string, unit: string, year: number, build: (existing: Target[]) => YearPlanResult<E>, alongside: TargetInput[] = [],
) {
  return run({ kind: 'plan', metric, unit, year, build, alongside: alongside.map(toRow) }) as Promise<{ northStar: Target; quarters: Target[]; months: Target[]; extra: E }>;
}

/** Delete a North Star, role, person or daily target that is not closed and has nothing under it. */
export async function deleteTarget(id: number): Promise<void> {
  await run({ kind: 'delete', id });
}

// ---- Role pool and person status (F-1102) ---------------------------------------------------------------------------

/** A person target that stops before its month ends was released by an unassign: it does not count. */
const liveHolderTargets = (roleId: number, month: { start: Date; end: Date }): Prisma.TargetWhereInput =>
  ({ scope: 'person', roleId, periodStart: month.start, periodEnd: { gte: month.end } });

/** A role can hold targets of several metrics; the page shows the real goal (orders, a rate) before revenue. */
const primaryRoleTarget = (rows: Target[]): Target | undefined => rows.find((t) => t.metric !== SPINE_METRIC) ?? rows[0];

/**
 * Roles for a month in a few queries: each role's target (the one given, else its primary one), what its persons hold, the pool, and
 * each current holder (a person, an AI agent or a company) with their target for it, or "Set a target" when the owner has not set one.
 * The pool route and the Targets page read this.
 */
export async function roleViews(roleIds: number[], month: string, given: Map<number, Target> = new Map()) {
  const bounds = periodBounds('role', month);
  const [roleTargets, assignments, persons] = await Promise.all([
    given.size === roleIds.length ? [] : prisma.target.findMany({ where: { scope: 'role', roleId: { in: roleIds }, periodStart: bounds.start }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.roleAssignment.findMany({ where: { roleId: { in: roleIds }, toDate: null }, select: { roleId: true, holder: { select: holderSelect } } }),
    prisma.target.findMany({ where: { scope: 'person', roleId: { in: roleIds }, periodStart: bounds.start, periodEnd: { gte: bounds.end } } }),
  ]);
  return roleIds.map((roleId) => {
    const target = given.get(roleId) ?? primaryRoleTarget(roleTargets.filter((t) => t.roleId === roleId)) ?? null;
    const mine = persons.filter((t) => t.roleId === roleId && (!target || t.metric === target.metric));
    const allocated = Money.sum(mine.map((t) => t.value));
    const byUser = new Map(mine.map((t) => [t.userId, t]));
    // A deactivated person keeps the assignment (reactivate restores it) but is not on the team: no row, no target to set.
    const holders = assignments.filter((a) => a.roleId === roleId && holderStatus(a.holder) !== 'deactivated').map(({ holder }) => {
      const own = byUser.get(holder.id);
      const view = holderView(holder);
      return {
        userId: holder.id, name: view.name, kind: holder.kind, typeLabel: view.typeLabel,
        target: own ? { id: own.id, metric: own.metric, unit: own.unit, value: Money.toApi(own.value) } : null,
        label: own ? null : SET_A_TARGET,
      };
    });
    return {
      roleId, month, target, holders,
      pool: target && { metric: target.metric, unit: target.unit, total: Money.toApi(target.value), allocated: Money.toApi(allocated), pool: Money.toApi(Money.sub(target.value, allocated)) },
    };
  });
}

/** One role for a month (see `roleViews`). */
export async function roleView(roleId: number, month: string) {
  const [{ target, ...rest }] = await roleViews([roleId], month);
  return rest;
}

interface ReleasedTargets {
  notice: string;
  returned: Array<{ metric: string; unit: string; value: string; month: string; kept: boolean }>;
  roleId: number;
  userId: number;
}

/**
 * Call inside the transaction that ends the assignment (roleAssignmentService.unassign). Releases the person's open targets
 * (see `releaseRows`) and returns the notice, or null when they had none. Send it after commit with `announceRelease`.
 */
export async function releasePersonTargets(
  tx: Db, p: { tenantId: string; roleId: number; roleName: string; userId: number },
): Promise<ReleasedTargets | null> {
  const released = await writeTarget(tx, p.tenantId, { kind: 'release', roleId: p.roleId, userId: p.userId, today: startOfUtcDay() }) as Target[];
  if (released.length === 0) return null;
  const person = fullName(await tx.user.findFirst({ where: { id: p.userId, tenantId: p.tenantId }, select: { firstName: true, lastName: true } })) || 'A person';
  const returned = released.map((t) => ({
    metric: t.metric, unit: t.unit, value: Money.toApi(t.value), month: ymdOfUtc(t.periodStart).slice(0, 7), kept: t.periodStart < startOfUtcDay(),
  }));
  const parts = returned.map((r) => `${r.value} ${r.unit} for ${r.month}`).join(', ');
  return { notice: `${person} left ${p.roleName}. Their target of ${parts} went back to the ${p.roleName} pool.`, returned, roleId: p.roleId, userId: p.userId };
}

/** After commit: one audit row with the released values, and the notice to the actor and the admins. Never fails the caller. */
export async function announceRelease(actorId: number, r: ReleasedTargets): Promise<void> {
  try {
    await auditService.record({
      actorId, actorKind: 'person', channel: 'app', action: 'target_release', resource: 'role', resourceId: String(r.roleId),
      metadata: { userId: r.userId, returned: r.returned },
    });
    const recipients = new Set([actorId, ...(await findTenantAdmins()).map((a) => a.id)]);
    await Promise.all([...recipients].map((id) =>
      createNotification(String(id), 'target_returned', 'Target returned to the role pool', r.notice, { roleId: r.roleId, userId: r.userId, returned: r.returned })));
  } catch (error) {
    logger.error('Target release: audit or notice failed', { roleId: r.roleId, userId: r.userId, error });
  }
}

// ---- Daily activity targets (F-1103) --------------------------------------------------------------------------------

/** Metrics that have a day-level source. Any other daily metric saves (`saveTarget`, scope daily), but has no data to read. */
const DAILY_SOURCES: Record<string, ((tenantId: string, from: Date, to: Date) => Promise<number>) | undefined> = {
  [FAILED_CALLS_METRIC]: async (tenantId, from, to) => (await failedDeliveryCalls(tenantId, from, to)).value,
};

/** The daily target in force on `date` ('YYYY-MM-DD') and that day's count. A metric with no source says "No data for this metric". */
export async function dailyTargetProgress(metric: string, date: string, userId?: number) {
  const tenantId = resolveTenantId();
  const day = utcDateOfYmd(date);
  const target = await prisma.target.findFirst({
    where: { scope: 'daily', metric, userId: userId ?? null, periodStart: { lte: day }, periodEnd: { gte: day } },
    orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
  });
  const source = DAILY_SOURCES[metric];
  const zone = getStoreTimeZone(tenantId);
  const actual = source ? await source(tenantId, startOfDay(date, zone), endOfDay(date, zone)) : null;
  return { metric, date, id: target?.id ?? null, unit: target?.unit ?? null, target: target ? Number(target.value) : null, actual, message: source ? null : NO_DATA_FOR_METRIC };
}

// ---- Month reads for rewards (M6-T09) -------------------------------------------------------------------------------

/**
 * The live person targets of a month, oldest first: the `liveHolderTargets` rule (a target cut short by an unassign is
 * released and does not count) for the current month; a past month includes the released ones, for every role or one `roleId`, every person or one `userId`.
 */
export function monthPersonTargets(period: string, filter: { userId?: number; roleId?: number } = {}) {
  const bounds = periodBounds('person', period);
  // liveHolderTargets names the role; the spread after it widens that to any role unless one is asked for.
  // A past month (F-1110) judges every person target that covered part of the month, for the person who held it.
  const month: Prisma.TargetWhereInput = period < currentMonth() ? { scope: 'person', periodStart: bounds.start } : liveHolderTargets(0, bounds);
  return prisma.target.findMany({
    where: { ...month, roleId: filter.roleId ?? { not: null }, userId: filter.userId ?? { not: null } },
    orderBy: { id: 'asc' },
  });
}

/** The role targets of a month (the `roleViews` rule: scope role, period start on the month). */
export function monthRoleTargets(period: string) {
  return prisma.target.findMany({ where: { scope: 'role', periodStart: periodBounds('role', period).start, roleId: { not: null } }, orderBy: { id: 'asc' } });
}

/** True when the month is closed: a month target that touches it has `closedAt` (the `closedMonths` rule, read without a lock). */
export async function isMonthClosed(period: string, db: Pick<TransactionClient, 'target'> = prisma): Promise<boolean> {
  const { start, end } = periodBounds('month', period);
  return (await db.target.count({ where: { scope: 'month', periodStart: { lte: end }, periodEnd: { gte: start }, closedAt: { not: null } } })) > 0;
}
