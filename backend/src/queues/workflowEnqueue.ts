/**
 * Add a workflow run to the queue without ever failing the caller (M9-T21).
 *
 * A trigger fires after the order is saved, so a queue that is down must not fail the order write or hold it.
 * When the add fails (or does not answer in 5 s) the run is written to `WorkflowTriggerOutbox` and the call returns.
 * A repeat job (`drainWorkflowOutbox`, every 30 s) adds the unprocessed rows oldest first. A row that fails 10 times
 * marks its execution failed. The job id is the execution id, so a slow add that lands late and a drain together
 * still make one job. The outbox is in the database, so a restart does not lose a pending run.
 */
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { resolveTenantId, runInTenant, withoutTenant } from '../utils/tenantContext';
import { workflowQueue } from './workflowQueue';

export const ENQUEUE_TIMEOUT_MS = 5000;
export const DRAIN_EVERY_MS = 30_000;
export const MAX_ATTEMPTS = 10;
export const DRAIN_BATCH = 100;
/** Processed outbox rows older than this are deleted by the drain job. */
export const OUTBOX_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const QUEUE_DOWN_ERROR = 'Workflow queue is unavailable';
export const OUTBOX_EVENT = 'execute-workflow';

export interface WorkflowRunJob {
  executionId: number;
  workflowId: number;
  actions: any[];
  conditions: any;
  input: any;
  tenantId: string | null;
}

export const runJobId = (executionId: number) => `wf-run:${executionId}`;

async function addOnce(job: WorkflowRunJob): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      workflowQueue.add(OUTBOX_EVENT, job, { jobId: runJobId(job.executionId) }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('queue add timed out')), ENQUEUE_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function markFailed(job: WorkflowRunJob, message = QUEUE_DOWN_ERROR): Promise<void> {
  const write = () => prisma.workflowExecution.update({
    where: { id: job.executionId },
    data: { status: 'failed', error: message, completedAt: new Date() },
  });
  try {
    await (job.tenantId ? runInTenant(job.tenantId, write) : write());
  } catch (error: any) {
    logger.error('Could not mark workflow execution failed', { executionId: job.executionId, error: error.message });
  }
}

/** Resolves true when the job was added, false when it was handed to the outbox. Never rejects. */
export async function enqueueWorkflowRun(job: WorkflowRunJob): Promise<boolean> {
  try {
    await addOnce(job);
    return true;
  } catch (error: any) {
    logger.warn('Workflow queue unavailable, run written to the outbox', { executionId: job.executionId, error: error.message });
    try {
      const tenantId = resolveTenantId(job.tenantId);
      await runInTenant(tenantId, () => prisma.workflowTriggerOutbox.create({
        data: { tenantId, event: OUTBOX_EVENT, payload: job as any, lastError: String(error.message).slice(0, 500) },
      }));
    } catch (outboxError: any) {
      logger.error('Workflow run dropped: queue and outbox both failed', { executionId: job.executionId, error: outboxError.message });
      await markFailed(job);
    }
    return false;
  }
}

/**
 * The repeat job (M9-T21): add the unprocessed outbox rows, oldest first. A row that was added is `processedAt`.
 * A row that failed keeps its `attempts` and `lastError`; at MAX_ATTEMPTS its execution is marked failed and the row is closed.
 * Rows processed more than 7 days ago are deleted. Returns how many runs reached the queue.
 */
export async function drainWorkflowOutbox(now: Date = new Date()): Promise<number> {
  return withoutTenant('workflow outbox drain', async () => {
    const rows = await prisma.workflowTriggerOutbox.findMany({
      where: { processedAt: null },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: DRAIN_BATCH,
    });
    let added = 0;
    for (const row of rows) {
      const job = row.payload as unknown as WorkflowRunJob;
      try {
        await addOnce(job);
        await prisma.workflowTriggerOutbox.update({
          where: { id: row.id }, data: { processedAt: new Date(), attempts: { increment: 1 }, lastError: null },
        });
        added++;
      } catch (error: any) {
        const attempts = row.attempts + 1;
        const lastError = String(error.message).slice(0, 500);
        const giveUp = attempts >= MAX_ATTEMPTS;
        await prisma.workflowTriggerOutbox.update({
          where: { id: row.id }, data: { attempts, lastError, ...(giveUp ? { processedAt: new Date() } : {}) },
        });
        if (giveUp) {
          logger.error('Workflow run dropped: queue unavailable after 10 attempts', { executionId: job.executionId, outboxId: row.id });
          await markFailed(job);
        }
      }
    }
    await prisma.workflowTriggerOutbox.deleteMany({ where: { processedAt: { lt: new Date(now.getTime() - OUTBOX_KEEP_MS) } } });
    return added;
  });
}
