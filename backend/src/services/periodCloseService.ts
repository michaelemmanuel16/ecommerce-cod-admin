import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { resolveTenantId } from '../utils/tenantContext';
import { forEachTenant } from '../utils/tenantLoop';
import { AppError } from '../middleware/errorHandler';
import * as Money from '../utils/money';
import { getCurrency } from '../utils/currency';
import { getStoreTimeZone, localDate, MONTH_RE } from './kpi/dates';
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
 *  - The month and the role, person and month targets of the month get `closedAt`, so T07 refuses edits to them.
 *  - One transaction per tenant-month under an advisory lock. Idempotent: an entry exists once per (tenant, person, reward,
 *    month, role) (a unique key), a month already closed returns what it holds, and a repeat creates and posts nothing.
 *  - If reading attainment fails, nothing is written and a Finding is opened. Nothing is paid on partial data.
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

/** The month must have ended in the store time zone. */
function assertPastMonth(period: string): void {
  if (!MONTH_RE.test(period)) throw new AppError('Period must be a month like 2026-09', 400, 'INVALID_PERIOD');
  const current = localDate(new Date(), getStoreTimeZone()).slice(0, 7);
  if (period >= current) throw new AppError(`${period} has not ended yet. A month can be closed after its last day.`, 400, 'MONTH_NOT_ENDED');
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
async function entriesOf(db: Pick<typeof prisma, 'commissionEntry'>, period: string) {
  const rows = await db.commissionEntry.findMany({
    where: { kind: 'reward', period },
    select: { id: true, userId: true, roleId: true, amount: true, status: true, note: true, journalEntryId: true, earnedAt: true, user: { select: { firstName: true, lastName: true } }, role: { select: { name: true } } },
    orderBy: [{ roleId: 'asc' }, { userId: 'asc' }],
  });
  return rows.map((e) => ({
    id: e.id, userId: e.userId, name: `${e.user.firstName} ${e.user.lastName}`.trim(), roleId: e.roleId, roleName: e.role?.name ?? null,
    amount: Money.toApi(e.amount), status: e.status, note: e.note, journalEntryId: e.journalEntryId, earnedAt: e.earnedAt,
  }));
}

/** POST /api/period-close/:yyyy-mm/preview. No write at all. */
export async function previewPeriodClose(period: string) {
  assertPastMonth(period);
  const { currency, rewards, closed } = await plan(period);
  const existing = new Set((await entriesOf(prisma, period)).map((e) => `${e.userId}:${e.roleId}`));
  return {
    period, currency, closed,
    entries: rewards.map((r) => ({ ...r, exists: existing.has(`${r.userId}:${r.roleId}`) })),
    total: Money.toApi(Money.sum(rewards.map((r) => r.amount))),
  };
}

/** The last day of the month, as a date the ledger books on. */
const lastDayOf = (period: string): Date => {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0));
};

/**
 * POST /api/period-close/:yyyy-mm. Creates and posts the reward entries and locks the month. `actorUserId` books the ledger
 * entries: the Owner for a hand run, the tenant's system user for the job.
 */
export async function runPeriodClose(period: string, actorUserId: number) {
  assertPastMonth(period);
  const tenantId = resolveTenantId();

  // A month closed already is not planned again: it returns what it holds.
  if (await isMonthClosed(period)) {
    const entries = await entriesOf(prisma, period);
    return { period, alreadyClosed: true, created: 0, closedTargets: 0, entries, total: Money.toApi(Money.sum(entries.map((e) => e.amount))) };
  }

  let planned: Awaited<ReturnType<typeof plan>>;
  try {
    planned = await plan(period);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Month close ${period} stopped: attainment could not be read`, { tenantId, error: message });
    await openFindingOnce({
      tenantId, type: 'ledger_post_failed', subjectType: 'period_close', subjectId: period,
      note: `Month close ${period} stopped, nothing was written. Attainment could not be read: ${message}`.slice(0, 500),
    }).catch((e) => logger.error('Could not open the month close Finding', { error: e }));
    throw new AppError(`Month close ${period} stopped: attainment could not be read. Nothing was written.`, 502, 'KPI_UNAVAILABLE');
  }

  const { start, end } = periodBounds('month', period);
  const earnedAt = lastDayOf(period);
  const result = await prisma.$transaction(async (tx) => {
    // One close per tenant and month at a time; the second waits, then sees the month closed.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:period-close:${period}`}))`;
    const closedNow = await tx.target.count({ where: { scope: 'month', periodStart: { lte: end }, periodEnd: { gte: start }, closedAt: { not: null } } });
    if (closedNow > 0) return { alreadyClosed: true, created: 0, closedTargets: 0 };

    let created = 0;
    for (const r of planned.rewards) {
      const key = { userId: r.userId, kind: 'reward' as const, period, roleId: r.roleId };
      let entry = await tx.commissionEntry.findFirst({ where: key, select: { id: true } });
      if (!entry) {
        entry = await tx.commissionEntry.create({
          data: { tenantId, ...key, amount: Money.parse(r.amount), status: 'earned', earnedAt, note: r.note },
          select: { id: true },
        });
        created += 1;
      }
      await postEntry(tx, entry.id, actorUserId); // a repeat on a posted entry posts nothing
    }
    const closed = await tx.target.updateMany({
      where: { periodStart: start, scope: { in: ['month', 'role', 'person'] }, closedAt: null },
      data: { closedAt: new Date() },
    });
    return { alreadyClosed: false, created, closedTargets: closed.count };
  });

  const entries = await entriesOf(prisma, period);
  return { period, ...result, entries, total: Money.toApi(Money.sum(entries.map((e) => e.amount))) };
}

/** The month before `now` in the store time zone, 'YYYY-MM'. */
export function previousMonth(now: Date = new Date()): string {
  const [y, m] = localDate(now, getStoreTimeZone()).slice(0, 7).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * The scheduled job: the month that ended, once per tenant, as that tenant's system user. A tenant that fails is logged and
 * has a Finding (a read failure opens its own); the others still run.
 */
export async function runPeriodCloseJob(now: Date = new Date()): Promise<void> {
  const period = previousMonth(now);
  await forEachTenant('Month close', async (tenantId) => {
    try {
      await runPeriodClose(period, await getSystemUserId(tenantId));
    } catch (error) {
      if (!(error instanceof AppError && error.errorCode === 'KPI_UNAVAILABLE')) {
        await openFindingOnce({
          tenantId, type: 'ledger_post_failed', subjectType: 'period_close', subjectId: period,
          note: `Month close ${period} failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500),
        }).catch((e) => logger.error('Could not open the month close Finding', { error: e }));
      }
      throw error;
    }
  });
}
