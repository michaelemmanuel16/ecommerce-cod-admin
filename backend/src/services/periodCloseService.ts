import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { resolveTenantId } from '../utils/tenantContext';
import { forEachTenant } from '../utils/tenantLoop';
import { AppError } from '../middleware/errorHandler';
import * as Money from '../utils/money';
import { getCurrency } from '../utils/currency';
import { currentMonth, getStoreTimeZone, MONTH_RE } from './kpi/dates';
import { openFindingOnce } from './findingService';
import { postEntry } from './commissionService';
import { computeAttainment } from './rewardService';
import { getSystemUserId } from './systemUserService';
import { isMonthClosed, periodBounds } from './targetService';

/**
 * M6-T10 (F-916, F-1110): month close. For a month that has ended it turns attainment into reward entries.
 *
 *  - The plan is `rewardService.computeAttainment` for the month: one rule, read by the preview and by the run.
 *  - A human holder at 100 percent or more gets one `CommissionEntry` kind `reward` for the tier reached (the 120 amount only,
 *    not both), with the day off as a note. It posts DR 5050 / CR 2020 on the last day of the month (`postEntry`).
 *  - The month and the role, person and month targets of the month get `closedAt`, so T07 refuses edits to them. The month
 *    target is the lock: a month with no month target has nothing to close (409 NOTHING_TO_CLOSE).
 *  - One transaction per tenant-month under an advisory lock. Idempotent: an entry exists once per (tenant, person, reward,
 *    month, role) (a unique key), a month already closed returns what it holds, and a repeat creates and posts nothing.
 *  - Any failure that is not a 4xx stops the run with nothing written and opens a Finding (a read failure is 502
 *    KPI_UNAVAILABLE). Nothing is paid on partial data.
 *  - A return after close does not take a reward back (no clawback).
 *
 * Call inside the tenant context.
 */

export interface PlannedReward {
  userId: number;
  name: string;
  roleId: number;
  roleName: string;
  percent: number | null;
  tier: '100' | '120';
  amount: string;
  dayOff: boolean;
  note: string | null;
}

export const DAY_OFF_NOTE = 'Paid day off';
const pairKey = (userId: number, roleId: number | null) => `${userId}:${roleId}`;

/** The month must have ended in the store time zone. */
function assertPastMonth(period: string, tenantId: string): void {
  if (!MONTH_RE.test(period)) throw new AppError('Period must be a month like 2026-09', 400, 'INVALID_PERIOD');
  if (period >= currentMonth(new Date(), getStoreTimeZone(tenantId))) {
    throw new AppError(`${period} has not ended yet. A month can be closed after its last day.`, 400, 'MONTH_NOT_ENDED');
  }
}

/** The rewards a close of the month would create. Reads only. */
async function plan(period: string): Promise<{ currency: string; rewards: PlannedReward[]; closed: boolean }> {
  const [attainment, currency] = await Promise.all([computeAttainment(period), getCurrency()]);
  const rewards: PlannedReward[] = attainment.results.flatMap((r) => {
    // Humans at a tier that pays. AI agents and companies have payout false and no reward; a zero amount makes no entry.
    if (!r.payout || !r.reward || r.tier === 'none' || !Money.parse(r.reward.amount).gt(0)) return [];
    return [{
      userId: r.userId, name: r.name, roleId: r.roleId, roleName: r.roleName, percent: r.percent, tier: r.tier,
      amount: r.reward.amount, dayOff: r.reward.dayOff, note: r.reward.dayOff ? DAY_OFF_NOTE : null,
    }];
  });
  return { currency, rewards, closed: attainment.closed };
}

/** The reward entries of a month as they stand now. */
async function entriesOf(period: string) {
  const rows = await prisma.commissionEntry.findMany({
    where: { kind: 'reward', period },
    select: { id: true, userId: true, roleId: true, amount: true, status: true, note: true, journalEntryId: true, earnedAt: true, user: { select: { firstName: true, lastName: true } }, role: { select: { name: true } } },
    orderBy: [{ roleId: 'asc' }, { userId: 'asc' }],
  });
  return rows.map((e) => ({
    id: e.id, userId: e.userId, name: `${e.user.firstName} ${e.user.lastName}`.trim(), roleId: e.roleId, roleName: e.role?.name ?? null,
    amount: Money.toApi(e.amount), status: e.status, note: e.note, journalEntryId: e.journalEntryId, earnedAt: e.earnedAt,
  }));
}

/** The answer of a run: what the run did (`head`), the entries the month holds now, and their total. */
async function closeResult<T extends object>(period: string, head: T) {
  const entries = await entriesOf(period);
  return { period, ...head, entries, total: Money.toApi(Money.sum(entries.map((e) => e.amount))) };
}

/** POST /api/period-close/:yyyy-mm/preview. No write at all. */
export async function previewPeriodClose(period: string) {
  assertPastMonth(period, resolveTenantId());
  const [{ currency, rewards, closed }, held] = await Promise.all([
    plan(period),
    prisma.commissionEntry.findMany({ where: { kind: 'reward', period }, select: { userId: true, roleId: true } }),
  ]);
  const existing = new Set(held.map((e) => pairKey(e.userId, e.roleId)));
  return {
    period, currency, closed,
    entries: rewards.map((r) => ({ ...r, exists: existing.has(pairKey(r.userId, r.roleId)) })),
    total: Money.toApi(Money.sum(rewards.map((r) => r.amount))),
  };
}

/** One Finding for a month close that stopped (a month and a failure make one key). Never throws. */
async function openCloseFinding(tenantId: string, period: string, note: string): Promise<void> {
  await openFindingOnce({ tenantId, type: 'ledger_post_failed', subjectType: 'period_close', subjectId: period, note: note.slice(0, 500) })
    .catch((e) => logger.error('Could not open the month close Finding', { error: e }));
}

/**
 * POST /api/period-close/:yyyy-mm. Creates and posts the reward entries and locks the month. `actorUserId` books the ledger
 * entries: the Owner for a hand run, the tenant's system user for the job. A failure that is not a 4xx opens a Finding and
 * writes nothing.
 */
export async function runPeriodClose(period: string, actorUserId: number) {
  const tenantId = resolveTenantId();
  assertPastMonth(period, tenantId);
  try {
    return await closeMonth(period, actorUserId, tenantId);
  } catch (error) {
    if (error instanceof AppError && error.statusCode < 500) throw error;
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Month close ${period} stopped`, { tenantId, error: message });
    await openCloseFinding(tenantId, period, `Month close ${period} stopped, nothing was written. ${message}`);
    throw error;
  }
}

async function closeMonth(period: string, actorUserId: number, tenantId: string) {
  const { start, end } = periodBounds('month', period);
  // The month target is the lock; with none there is nothing to close (no person target exists without one).
  if ((await prisma.target.count({ where: { scope: 'month', periodStart: { lte: end }, periodEnd: { gte: start } } })) === 0) {
    throw new AppError(`No target for ${period}. There is nothing to close.`, 409, 'NOTHING_TO_CLOSE');
  }
  // A month closed already is not planned again: it returns what it holds.
  if (await isMonthClosed(period)) return closeResult(period, { alreadyClosed: true, created: 0, closedTargets: 0 });

  let planned: Awaited<ReturnType<typeof plan>>;
  try {
    planned = await plan(period);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(`Month close ${period} stopped: attainment could not be read (${message}). Nothing was written.`, 502, 'KPI_UNAVAILABLE');
  }

  const earnedAt = periodBounds('month', period).end; // the last day of the month
  const head = await prisma.$transaction(async (tx) => {
    // One close per tenant and month at a time; the second waits, then sees the month closed.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:period-close:${period}`}))`;
    if (await isMonthClosed(period, tx)) return { alreadyClosed: true, created: 0, closedTargets: 0 };

    const held = new Map((await tx.commissionEntry.findMany({
      where: { kind: 'reward', period }, select: { id: true, userId: true, roleId: true, journalEntryId: true },
    })).map((e) => [pairKey(e.userId, e.roleId), e]));
    let created = 0;
    for (const r of planned.rewards) {
      let entry = held.get(pairKey(r.userId, r.roleId));
      if (!entry) {
        entry = await tx.commissionEntry.create({
          data: { tenantId, userId: r.userId, kind: 'reward', period, roleId: r.roleId, amount: Money.parse(r.amount), status: 'earned', earnedAt, note: r.note },
          select: { id: true, userId: true, roleId: true, journalEntryId: true },
        });
        created += 1;
      }
      if (entry.journalEntryId === null) await postEntry(tx, entry.id, actorUserId);
    }
    const closed = await tx.target.updateMany({
      where: { periodStart: start, scope: { in: ['month', 'role', 'person'] }, closedAt: null },
      data: { closedAt: new Date() },
    });
    return { alreadyClosed: false, created, closedTargets: closed.count };
  }, { timeout: 60_000, maxWait: 10_000 });

  return closeResult(period, head);
}

/** The month before `now` in the store time zone of the tenant, 'YYYY-MM'. */
export function previousMonth(now: Date = new Date(), tenantId?: string): string {
  const [y, m] = currentMonth(now, getStoreTimeZone(tenantId)).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * The scheduled job: the month that ended (in each tenant's zone), once per tenant, as that tenant's system user. A tenant
 * with no target for the month is skipped quietly. Any other failure has its Finding from `runPeriodClose`; forEachTenant
 * logs it and the other tenants still run.
 */
export async function runPeriodCloseJob(now: Date = new Date()): Promise<void> {
  await forEachTenant('Month close', async (tenantId) => {
    const period = previousMonth(now, tenantId);
    try {
      await runPeriodClose(period, await getSystemUserId(tenantId));
    } catch (error) {
      if (error instanceof AppError && error.errorCode === 'NOTHING_TO_CLOSE') {
        logger.info(`Month close ${period}: tenant ${tenantId} has no target for the month, skipped`);
        return;
      }
      throw error;
    }
  });
}
