import { Target, TargetScope } from '@prisma/client';
import prisma, { TransactionClient } from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import { startOfUtcDay } from '../utils/startOfUtcDay';
import { AppError } from '../middleware/errorHandler';
import * as Money from '../utils/money';
import { createNotification } from './notificationService';
import { HUMAN_USERS_WHERE } from './systemUserService';
import { failedDeliveryCalls, FAILED_CALLS_METRIC } from './kpi/daily';
import { startOfDay, endOfDay, getStoreTimeZone, utcDateOfYmd, ymdOfUtc } from './kpi/dates';

/**
 * M6-T07 (F-1100, F-1103): the target tree on the one `Target` table.
 *
 *   north_star (year) -> quarter -> month -> role -> person        and a separate `daily` activity target
 *
 * - A period is a string: '2026' (north_star), '2026-Q4' (quarter), '2026-10' (month, role, person). A daily target has a
 *   start day and stands until a newer one replaces it.
 * - A child is the same metric as its parent. Quarters must add up to the North Star and months to their quarter: `setChildren`
 *   saves the whole set and rejects a set that does not add up, with the difference. A single write cannot push the sum over
 *   the parent. Persons may add up to less than their role: what is left is the role pool.
 * - A closed month (`closedAt` set on the month target) and everything inside it cannot be edited.
 * - A holder added mid-month gets no automatic share: until the owner sets one, the person shows "Set a target" (F-1102).
 */

export const SET_A_TARGET = 'Set a target';
export const NO_DATA_FOR_METRIC = 'No data for this metric';

/** The scope a parent must have, per child scope. A daily target has no parent. */
const PARENT_SCOPE: Partial<Record<TargetScope, TargetScope>> = {
  quarter: 'north_star', month: 'quarter', role: 'month', person: 'role',
};
/** Children of these scopes must add up to the parent exactly. Persons under a role may add up to less (the pool). */
const EXACT_PARENT: ReadonlySet<TargetScope> = new Set<TargetScope>(['north_star', 'quarter']);
/** A daily target that is not replaced runs to this day. */
const OPEN_END = new Date(Date.UTC(2999, 11, 31));

export interface TargetInput {
  scope: TargetScope;
  metric: string;
  unit: string;
  value: Money.MoneyInput;
  /** '2026' | '2026-Q4' | '2026-10' for the tree; a start day 'YYYY-MM-DD' for daily (default today). */
  period?: string;
  /** Optional. Without one, the target is linked to the parent that covers its period with the same metric (a person: the role target of the same role). */
  parentId?: number;
  roleId?: number;
  userId?: number;
}

type Db = Pick<TransactionClient, 'target' | 'roleAssignment'>;

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const money = (v: Money.MoneyInput) => Money.toApi(v);

/** [start, end] of a period string for `scope`. */
export function periodBounds(scope: TargetScope, period?: string): { start: Date; end: Date } {
  const bad = () => new AppError(`Invalid period "${period}" for a ${scope} target`, 400, 'INVALID_PERIOD');
  if (scope === 'daily') {
    const start = period ? utcDateOfYmd(period) : startOfUtcDay();
    if (period && (!/^\d{4}-\d{2}-\d{2}$/.test(period) || Number.isNaN(start.getTime()))) throw bad();
    return { start, end: OPEN_END };
  }
  if (!period) throw bad();
  if (scope === 'north_star') {
    if (!/^\d{4}$/.test(period)) throw bad();
    const y = Number(period);
    return { start: utc(y, 0, 1), end: utc(y, 11, 31) };
  }
  if (scope === 'quarter') {
    const m = /^(\d{4})-Q([1-4])$/.exec(period);
    if (!m) throw bad();
    const y = Number(m[1]); const first = (Number(m[2]) - 1) * 3;
    return { start: utc(y, first, 1), end: utc(y, first + 3, 0) };
  }
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!m) throw bad();
  const y = Number(m[1]); const mo = Number(m[2]) - 1;
  return { start: utc(y, mo, 1), end: utc(y, mo + 1, 0) };
}

/** The sum check message: "<what> add up to X, the <parent> is Y (Z over|short)". */
function sumError(childName: string, parentName: string, sum: Money.Money, parent: Money.Money): AppError {
  const diff = Money.sub(sum, parent);
  const how = diff.gt(0) ? `${money(diff)} over` : `${money(diff.abs())} short`;
  return new AppError(
    `The ${childName} add up to ${money(sum)} but the ${parentName} is ${money(parent)} (${how}). Difference: ${money(diff.abs())}`,
    400, 'CHILDREN_SUM_MISMATCH',
  );
}

const CLOSED_MESSAGE = 'This month is closed and its targets cannot be edited';

/** A month target that covers [start, end] and is closed locks everything inside it. */
async function assertNotClosed(db: Db, start: Date, end: Date, target?: Pick<Target, 'closedAt'> | null) {
  if (target?.closedAt) throw new AppError(CLOSED_MESSAGE, 409, 'MONTH_CLOSED');
  const closed = await db.target.count({
    where: { scope: 'month', closedAt: { not: null }, periodStart: { lte: end }, periodEnd: { gte: start } },
  });
  if (closed > 0) throw new AppError(CLOSED_MESSAGE, 409, 'MONTH_CLOSED');
}

async function findParent(db: Db, input: TargetInput, start: Date): Promise<Target | null> {
  const need = PARENT_SCOPE[input.scope];
  if (!need) return null;
  let parent: Target | null = null;
  if (input.parentId !== undefined) {
    parent = await db.target.findFirst({ where: { id: input.parentId } });
    if (!parent) throw new AppError('Parent target not found', 404);
    if (parent.scope !== need) throw new AppError(`A ${input.scope} target sits under a ${need} target`, 400, 'WRONG_PARENT_SCOPE');
  } else {
    // No parent named: link to the one that covers this period with the same metric, if there is one.
    parent = await db.target.findFirst({
      where: {
        scope: need, metric: input.metric, periodStart: { lte: start }, periodEnd: { gte: start },
        ...(input.scope === 'person' ? { roleId: input.roleId } : { roleId: null, userId: null }),
      },
    });
  }
  if (parent) {
    if (parent.metric !== input.metric) throw new AppError(`The parent target is "${parent.metric}"; a child uses the same metric`, 400, 'METRIC_MISMATCH');
    if (start < parent.periodStart || start > parent.periodEnd
      || ((input.scope === 'role' || input.scope === 'person') && ymdOfUtc(parent.periodStart) !== ymdOfUtc(start))) {
      throw new AppError('The child period is outside the parent period', 400, 'INVALID_PERIOD');
    }
    if (input.scope === 'person' && parent.roleId !== input.roleId) throw new AppError('The role target belongs to another role', 400, 'WRONG_PARENT_SCOPE');
  }
  return parent;
}

/** The row for the same scope, metric, period and owner, if one exists. */
const findSame = (db: Db, input: TargetInput, start: Date) =>
  db.target.findFirst({
    where: {
      scope: input.scope, metric: input.metric, periodStart: start,
      roleId: input.roleId ?? null, userId: input.userId ?? null,
    },
  });

async function assertPersonHoldsRole(db: Db, roleId: number, userId: number) {
  if ((await db.roleAssignment.count({ where: { roleId, holderId: userId, toDate: null } })) === 0) {
    throw new AppError('This person does not hold the role', 400, 'NOT_A_HOLDER');
  }
}

function assertShape(input: TargetInput) {
  const { scope } = input;
  if (!input.metric?.trim() || !input.unit?.trim()) throw new AppError('A target needs a metric and a unit', 400);
  const value = Money.tryParse(input.value);
  if (value === null || value.lt(0)) throw new AppError('A target value must be a number of 0 or more', 400);
  if ((scope === 'role' || scope === 'person') && !input.roleId) throw new AppError(`A ${scope} target needs a role`, 400);
  if (scope === 'person' && !input.userId) throw new AppError('A person target needs a person', 400);
  if (scope !== 'role' && scope !== 'person' && scope !== 'daily' && (input.roleId || input.userId)) {
    throw new AppError(`A ${scope} target has no role or person`, 400);
  }
}

/** Sibling sum (excluding `selfId`) plus `value`, against the parent. Over the parent is always rejected. */
async function assertFitsParent(db: Db, parent: Target, value: Money.Money, selfId?: number) {
  const siblings = await db.target.findMany({ where: { parentId: parent.id, ...(selfId ? { id: { not: selfId } } : {}) }, select: { value: true } });
  const sum = Money.add(Money.sum(siblings.map((s) => s.value)), value);
  if (sum.gt(parent.value)) throw sumError(PARENT_SCOPE_CHILD_NAME[parent.scope], parent.scope.replace('_', ' '), sum, parent.value);
}
const PARENT_SCOPE_CHILD_NAME: Record<TargetScope, string> = {
  north_star: 'quarters', quarter: 'months', month: 'role targets', role: 'person targets', person: 'targets', daily: 'targets',
};

/** Save one target (create, or update the row for the same scope, metric, period and owner). */
export async function saveTarget(input: TargetInput): Promise<Target> {
  const tenantId = resolveTenantId();
  assertShape(input);
  const value = Money.parse(input.value);
  const { start, end } = periodBounds(input.scope, input.period);
  return prisma.$transaction(async (tx) => {
    await assertNotClosed(tx, start, input.scope === 'daily' ? start : end);
    if (input.scope === 'person') await assertPersonHoldsRole(tx, input.roleId!, input.userId!);
    const parent = await findParent(tx, input, start);
    const existing = await findSame(tx, input, start);
    if (existing) await assertNotClosed(tx, start, end, existing);

    if (parent) await assertFitsParent(tx, parent, value, existing?.id);
    if (existing) {
      // A parent whose children add up exactly keeps adding up: its value moves only through `setChildren` of the level above.
      const kids = await tx.target.findMany({ where: { parentId: existing.id }, select: { value: true } });
      if (kids.length > 0) {
        const sum = Money.sum(kids.map((k) => k.value));
        if (EXACT_PARENT.has(existing.scope) ? !sum.eq(value) : sum.gt(value)) {
          throw sumError(PARENT_SCOPE_CHILD_NAME[existing.scope], existing.scope.replace('_', ' '), sum, value);
        }
      }
    }

    if (input.scope === 'daily') {
      // A new start day closes the previous open target of the same metric and owner the day before.
      if (!existing) {
        await tx.target.updateMany({
          where: { scope: 'daily', metric: input.metric, userId: input.userId ?? null, periodStart: { lt: start }, periodEnd: { gte: start } },
          data: { periodEnd: new Date(start.getTime() - 86_400_000) },
        });
      }
    }
    const data = { unit: input.unit, value, parentId: parent?.id ?? null };
    if (existing) return tx.target.update({ where: { id: existing.id }, data });
    return tx.target.create({
      data: {
        tenantId, scope: input.scope, metric: input.metric, unit: input.unit, value,
        periodStart: start, periodEnd: end, parentId: parent?.id ?? null,
        roleId: input.roleId ?? null, userId: input.userId ?? null,
      },
    });
  });
}

export interface ChildInput { period: string; value: Money.MoneyInput; roleId?: number; userId?: number }

/**
 * Save the whole set of children of a North Star or quarter target at once. The set must add up to the parent exactly: a set
 * that does not is rejected with the difference and nothing is saved. Children of the parent that are not in the set count in
 * the sum. Returns the children.
 */
export async function setChildren(parentId: number, children: ChildInput[]): Promise<Target[]> {
  const tenantId = resolveTenantId();
  return prisma.$transaction(async (tx) => {
    const parent = await tx.target.findFirst({ where: { id: parentId } });
    if (!parent) throw new AppError('Parent target not found', 404);
    if (!EXACT_PARENT.has(parent.scope)) throw new AppError('Only a North Star or quarter target takes a set of children', 400, 'WRONG_PARENT_SCOPE');
    await assertNotClosed(tx, parent.periodStart, parent.periodEnd, parent);
    const scope = PARENT_SCOPE_OF[parent.scope];
    const values = new Map<number, Money.Money>();
    for (const old of await tx.target.findMany({ where: { parentId } })) values.set(old.id, old.value);
    const plan = children.map((c) => {
      const value = Money.tryParse(c.value);
      if (value === null || value.lt(0)) throw new AppError('A target value must be a number of 0 or more', 400);
      const { start, end } = periodBounds(scope, c.period);
      if (start < parent.periodStart || end > parent.periodEnd) throw new AppError(`${c.period} is outside the parent period`, 400, 'INVALID_PERIOD');
      return { start, end, value };
    });
    const existing = await Promise.all(plan.map((p) => tx.target.findFirst({ where: { scope, metric: parent.metric, periodStart: p.start, roleId: null, userId: null } })));
    existing.forEach((row, i) => { if (row) values.set(row.id, plan[i].value); });
    const fresh = plan.filter((_, i) => !existing[i]);
    const sum = Money.add(Money.sum(values.values()), Money.sum(fresh.map((p) => p.value)));
    if (!sum.eq(parent.value)) throw sumError(PARENT_SCOPE_CHILD_NAME[parent.scope], parent.scope.replace('_', ' '), sum, parent.value);

    const saved: Target[] = [];
    for (let i = 0; i < plan.length; i++) {
      const p = plan[i]; const row = existing[i];
      if (row) {
        await assertNotClosed(tx, p.start, p.end, row);
        saved.push(await tx.target.update({ where: { id: row.id }, data: { value: p.value, parentId } }));
      } else {
        await assertNotClosed(tx, p.start, p.end);
        saved.push(await tx.target.create({
          data: { tenantId, scope, metric: parent.metric, unit: parent.unit, value: p.value, periodStart: p.start, periodEnd: p.end, parentId },
        }));
      }
    }
    return saved;
  });
}
const PARENT_SCOPE_OF: Record<string, TargetScope> = { north_star: 'quarter', quarter: 'month' };

/** Delete a target that is not closed and has no children. */
export async function deleteTarget(id: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const target = await tx.target.findFirst({ where: { id } });
    if (!target) throw new AppError('Target not found', 404);
    await assertNotClosed(tx, target.periodStart, target.scope === 'daily' ? target.periodStart : target.periodEnd, target);
    if ((await tx.target.count({ where: { parentId: id } })) > 0) throw new AppError('Remove the targets under it first', 409, 'HAS_CHILDREN');
    await tx.target.delete({ where: { id } });
  });
}

// ---- Role pool and person status (F-1102) ---------------------------------------------------------------------------

/** The role's target for a month, what its persons hold, and what is left (the pool). Null when the role has no target. */
export async function rolePool(roleId: number, month: string, metric?: string) {
  const { start } = periodBounds('role', month);
  const role = await prisma.target.findFirst({
    where: { scope: 'role', roleId, periodStart: start, ...(metric ? { metric } : {}) }, orderBy: { createdAt: 'asc' },
  });
  if (!role) return null;
  const persons = await prisma.target.findMany({ where: { scope: 'person', roleId, periodStart: start, metric: role.metric } });
  const allocated = Money.sum(persons.map((p) => p.value));
  return { target: role, metric: role.metric, unit: role.unit, total: money(role.value), allocated: money(allocated), pool: money(Money.sub(role.value, allocated)) };
}

/** Each current holder of a role with their target for the month, or "Set a target" when the owner has not set one. */
export async function roleHolderTargets(roleId: number, month: string) {
  const { start } = periodBounds('role', month);
  const [holders, targets] = await Promise.all([
    prisma.roleAssignment.findMany({
      where: { roleId, toDate: null, holder: { ...HUMAN_USERS_WHERE } },
      select: { holder: { select: { id: true, firstName: true, lastName: true } } },
    }),
    prisma.target.findMany({ where: { scope: 'person', roleId, periodStart: start } }),
  ]);
  return holders.map(({ holder }) => {
    const mine = targets.find((t) => t.userId === holder.id);
    return {
      userId: holder.id, name: `${holder.firstName} ${holder.lastName}`.trim(),
      target: mine ? { id: mine.id, metric: mine.metric, unit: mine.unit, value: money(mine.value) } : null,
      label: mine ? null : SET_A_TARGET,
    };
  });
}

/**
 * Called when a person's assignment to a role ends (roleAssignmentService.unassign). Their open person targets (this month on)
 * are removed, so the amount goes back to the role pool. Closed months keep theirs. Returns the notice, and tells the Owner
 * and Admins by notification. Null when the person had no open target.
 */
export async function returnPersonTargetsToPool(actorId: number, roleId: number, userId: number) {
  const today = startOfUtcDay();
  const open = await prisma.target.findMany({
    where: { scope: 'person', roleId, userId, closedAt: null, periodEnd: { gte: today } },
  });
  const removable: Target[] = [];
  for (const t of open) {
    const closed = await prisma.target.count({ where: { scope: 'month', closedAt: { not: null }, periodStart: { lte: t.periodEnd }, periodEnd: { gte: t.periodStart } } });
    if (closed === 0) removable.push(t);
  }
  if (removable.length === 0) return null;
  await prisma.target.deleteMany({ where: { id: { in: removable.map((t) => t.id) } } });

  const [person, role] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId }, select: { firstName: true, lastName: true } }),
    prisma.role.findFirst({ where: { id: roleId }, select: { name: true } }),
  ]);
  const returned = removable.map((t) => ({ metric: t.metric, unit: t.unit, value: money(t.value), periodStart: ymdOfUtc(t.periodStart) }));
  const who = person ? `${person.firstName} ${person.lastName}`.trim() : 'A person';
  const notice = `${who} left ${role?.name ?? 'the role'}. Their target of ${returned.map((r) => `${r.value} ${r.unit}`).join(', ')} went back to the ${role?.name ?? 'role'} pool.`;
  const admins = await prisma.user.findMany({ where: { role: { in: ['admin', 'super_admin'] }, isActive: true, ...HUMAN_USERS_WHERE }, select: { id: true } });
  const recipients = new Set([actorId, ...admins.map((a) => a.id)]);
  for (const id of recipients) await createNotification(String(id), 'target_returned', 'Target returned to the role pool', notice, { roleId, userId, returned });
  return { notice, returned };
}

// ---- Daily activity targets (F-1103) --------------------------------------------------------------------------------

/** Metrics that have a day-level source. Any other daily metric saves, but has no data to read. */
const DAILY_SOURCES: Record<string, (tenantId: string, from: Date, to: Date) => Promise<number>> = {
  [FAILED_CALLS_METRIC]: async (tenantId, from, to) => (await failedDeliveryCalls(tenantId, from, to)).value,
};

export interface DailyTargetInput { metric: string; value: Money.MoneyInput; unit?: string; from?: string; userId?: number }

/** Save a daily activity target ("failed delivery calls 15"). A newer start day replaces the one before it from that day. */
export function saveDailyTarget(input: DailyTargetInput): Promise<Target> {
  return saveTarget({ scope: 'daily', metric: input.metric, unit: input.unit ?? 'count', value: input.value, period: input.from, userId: input.userId });
}

/** The daily target in force on `date` ('YYYY-MM-DD') and today's count. A metric with no source says "No data for this metric". */
export async function dailyTargetProgress(metric: string, date: string, userId?: number) {
  const tenantId = resolveTenantId();
  const day = utcDateOfYmd(date);
  const target = await prisma.target.findFirst({
    where: { scope: 'daily', metric, userId: userId ?? null, periodStart: { lte: day }, periodEnd: { gte: day } },
    orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
  });
  const source = DAILY_SOURCES[metric];
  if (!source) return { metric, date, target: target ? Number(target.value) : null, actual: null, message: NO_DATA_FOR_METRIC };
  const zone = getStoreTimeZone(tenantId);
  const actual = await source(tenantId, startOfDay(date, zone), endOfDay(date, zone));
  return { metric, date, target: target ? Number(target.value) : null, actual, message: null };
}
