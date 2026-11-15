/**
 * Schedule trigger (M9-T22): one Bull repeat job per active schedule workflow, re-synced when the workflow changes.
 *
 * A schedule workflow stores `triggerType = time_based` and `triggerData = { cron, timeZone }`. Each run has no order.
 * `idempotencyKey = schedule:<workflowId>:<planned run ISO time>` (unique per tenant) stops a double run: the repeat job,
 * the start-up catch-up and a retry can all try the same planned time and only one execution row exists.
 * A planned run that was missed (server down) and is less than 1 hour late runs once at start-up (`catch_up`);
 * one that is 1 hour or more late is skipped and written as a `skipped` execution with reason `missed_schedule`.
 *
 * This file does not import workflowService (it imports this file); the run goes through a lazy import.
 */
import Bull from 'bull';
import { parseExpression } from 'cron-parser';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { isValidTimeZone } from '../utils/timeZone';
import { runInTenant, runJobInTenant, withoutTenant } from '../utils/tenantContext';
import { DEFAULT_TIME_ZONE } from '../services/kpi/dates';
import { workflowQueue, SCHEDULE_JOB } from './workflowQueue';

/** A missed run less than this late runs once at start-up; later is skipped. */
export const CATCH_UP_WINDOW_MS = 60 * 60 * 1000;
export const MISSED_SCHEDULE_REASON = 'missed_schedule';

// No colon: Bull splits a repeat key on ':' to read it back (getRepeatableJobs), and a colon in the job id corrupts the parse.
export const scheduleJobId = (workflowId: number) => `wf-schedule-${workflowId}`;
export const scheduleKey = (workflowId: number, plannedAt: Date) => `schedule:${workflowId}:${plannedAt.toISOString()}`;

export interface ScheduleTrigger { cron: string; timeZone: string }

/** The schedule a workflow's trigger data holds, or null when it holds none. */
export function readSchedule(triggerData: unknown): ScheduleTrigger | null {
  const data = (triggerData ?? {}) as { cron?: unknown; timeZone?: unknown };
  if (typeof data.cron !== 'string' || !data.cron.trim()) return null;
  return { cron: data.cron.trim(), timeZone: typeof data.timeZone === 'string' && data.timeZone ? data.timeZone : DEFAULT_TIME_ZONE };
}

/** Refuses a schedule whose cron or time zone does not parse (400). Returns the schedule with the zone filled in. */
export function validateSchedule(triggerData: unknown, defaultZone: string = DEFAULT_TIME_ZONE): ScheduleTrigger {
  const raw = (triggerData ?? {}) as { cron?: unknown; timeZone?: unknown };
  const schedule = readSchedule({ ...raw, timeZone: raw.timeZone || defaultZone });
  if (!schedule) throw new AppError('A schedule needs a cron expression', 400);
  if (!isValidTimeZone(schedule.timeZone)) throw new AppError(`Unknown time zone "${schedule.timeZone}"`, 400);
  try {
    parseExpression(schedule.cron, { tz: schedule.timeZone });
  } catch {
    throw new AppError(`"${schedule.cron}" is not a valid cron expression`, 400);
  }
  return schedule;
}

/** The latest planned run at or before `now`, or null when the cron has none. */
export function lastPlannedRun(schedule: ScheduleTrigger, now: Date): Date | null {
  try {
    // +1 s so a run planned for exactly `now` counts
    return parseExpression(schedule.cron, { currentDate: new Date(now.getTime() + 1000), tz: schedule.timeZone }).prev().toDate();
  } catch {
    return null;
  }
}

interface ScheduledWorkflow {
  id: number;
  tenantId: string | null;
  isActive: boolean;
  triggerType: string;
  triggerData: unknown;
}

export const isScheduleWorkflow = (w: { triggerType: string }) => w.triggerType === 'time_based';

type RepeatableJob = Awaited<ReturnType<Bull.Queue['getRepeatableJobs']>>[number];

async function removeRepeat(queue: Bull.Queue, workflowId: number, repeats?: RepeatableJob[]): Promise<void> {
  for (const repeat of repeats ?? await queue.getRepeatableJobs()) {
    if (repeat.name === SCHEDULE_JOB && repeat.id === scheduleJobId(workflowId)) await queue.removeRepeatableByKey(repeat.key);
  }
}

/**
 * Make the queue match one workflow: remove its repeat job, then add one when it is an active schedule workflow.
 * Called when a workflow is created, edited, switched on or off, or deleted (pass `isActive: false` for a delete).
 * `repeats` is the queue's current repeat list when the caller already read it (start-up syncs every workflow from one read).
 */
export async function syncWorkflowSchedule(workflow: ScheduledWorkflow, queue: Bull.Queue = workflowQueue, repeats?: RepeatableJob[]): Promise<void> {
  // The queue is a stub in tests (no repeat support): nothing to sync
  if (typeof queue.getRepeatableJobs !== 'function') return;
  await removeRepeat(queue, workflow.id, repeats);
  const schedule = workflow.isActive && isScheduleWorkflow(workflow) ? readSchedule(workflow.triggerData) : null;
  if (!schedule || !workflow.tenantId) return;
  await queue.add(
    SCHEDULE_JOB,
    { workflowId: workflow.id, tenantId: workflow.tenantId },
    { repeat: { cron: schedule.cron, tz: schedule.timeZone }, jobId: scheduleJobId(workflow.id), removeOnComplete: true, removeOnFail: true },
  );
  logger.info('Workflow schedule synced', { workflowId: workflow.id, cron: schedule.cron, timeZone: schedule.timeZone });
}

/**
 * One planned run. `source` is `schedule` (the repeat job) or `catch_up` (start-up). A run 1 hour or more late is skipped.
 * Runs inside the workflow's tenant. Returns what happened, for the caller and the tests.
 */
export async function fireScheduledRun(
  workflowId: number, plannedAt: Date, source: 'schedule' | 'catch_up', now: Date = new Date(),
): Promise<'started' | 'duplicate' | 'skipped' | 'ignored'> {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow || !workflow.isActive || !isScheduleWorkflow(workflow)) return 'ignored';

  const { default: workflowService } = await import('../services/workflowService');
  const idempotencyKey = scheduleKey(workflowId, plannedAt);
  const markRan = () => prisma.workflow.updateMany({
    where: { id: workflowId, OR: [{ lastScheduledRunAt: null }, { lastScheduledRunAt: { lt: plannedAt } }] },
    data: { lastScheduledRunAt: plannedAt },
  });

  if (now.getTime() - plannedAt.getTime() >= CATCH_UP_WINDOW_MS) {
    const row = await workflowService.createExecution(
      workflow, { scheduledFor: plannedAt.toISOString() }, { triggerSource: source, idempotencyKey },
      { status: 'skipped', error: MISSED_SCHEDULE_REASON, completedAt: now },
    );
    if (row) logger.warn('Workflow schedule skipped: more than 1 hour late', { workflowId, plannedAt: plannedAt.toISOString() });
    await markRan();
    return row ? 'skipped' : 'duplicate';
  }

  const result = await workflowService.enqueueRun(
    workflow, { scheduledFor: plannedAt.toISOString() }, undefined, { triggerSource: source, idempotencyKey, orderId: null },
  );
  await markRan();
  return 'execution' in result ? 'started' : 'duplicate';
}

/** The repeat job's processor. Bull's `prevMillis` is the planned time of this run. */
export async function processScheduledJob(job: Bull.Job): Promise<void> {
  const { workflowId, tenantId } = job.data;
  const plannedAt = new Date((job.opts as { prevMillis?: number }).prevMillis ?? job.timestamp);
  await runJobInTenant(`Workflow schedule ${job.id} (workflow ${workflowId})`, tenantId, () => fireScheduledRun(workflowId, plannedAt, 'schedule'));
}

/**
 * Start-up (M9-T22): for every active schedule workflow, a planned run since its last run that never happened runs once
 * (`catch_up`) when it is under 1 hour late, and is skipped and logged when it is later. Returns the workflows it acted on.
 */
export async function catchUpMissedSchedules(now: Date = new Date()): Promise<number> {
  const workflows = await withoutTenant('workflow schedule catch-up', () => prisma.workflow.findMany({
    where: { isActive: true, triggerType: 'time_based' },
  }));
  let acted = 0;
  for (const workflow of workflows) {
    const schedule = readSchedule(workflow.triggerData);
    if (!schedule || !workflow.tenantId) continue;
    const planned = lastPlannedRun(schedule, now);
    // Never run yet: the workflow counts from the last time it was saved (it may have been switched on then)
    const since = workflow.lastScheduledRunAt ?? workflow.updatedAt;
    if (!planned || planned.getTime() <= since.getTime()) continue;
    try {
      const outcome = await runInTenant(workflow.tenantId, () => fireScheduledRun(workflow.id, planned, 'catch_up', now));
      if (outcome !== 'ignored') acted++;
    } catch (error: any) {
      logger.error('Workflow schedule catch-up failed', { workflowId: workflow.id, error: error.message });
    }
  }
  return acted;
}

/**
 * Start-up: one repeat job per active schedule workflow, and none for a workflow that no longer has a schedule
 * (a deleted or switched-off one whose repeat job was left in Redis). Then the catch-up.
 */
export async function setupWorkflowSchedules(queue: Bull.Queue = workflowQueue): Promise<void> {
  if (process.env.NODE_ENV === 'test' && queue === workflowQueue) return;
  const workflows = await withoutTenant('workflow schedule setup', () => prisma.workflow.findMany({
    where: { triggerType: 'time_based' },
    select: { id: true, tenantId: true, isActive: true, triggerType: true, triggerData: true },
  }));
  const live = new Set(workflows.filter((w) => w.isActive && readSchedule(w.triggerData) && w.tenantId).map((w) => scheduleJobId(w.id)));
  const repeats = await queue.getRepeatableJobs();
  const kept: RepeatableJob[] = [];
  for (const repeat of repeats) {
    if (repeat.name === SCHEDULE_JOB && !live.has(repeat.id ?? '')) await queue.removeRepeatableByKey(repeat.key);
    else kept.push(repeat);
  }
  for (const workflow of workflows) await syncWorkflowSchedule(workflow, queue, kept);
  const caught = await catchUpMissedSchedules();
  logger.info('Workflow schedules set up', { schedules: live.size, caughtUp: caught });
}
