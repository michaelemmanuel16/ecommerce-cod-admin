/**
 * Add a workflow run to the queue without ever failing the caller (M9-T21).
 *
 * A trigger fires after the order is saved, so a queue that is down must not fail the order write or hold it.
 * When the add fails (or does not answer in 5 s) the run stays in memory and the add is tried again, up to 3 times,
 * 30 s apart. If all tries fail the execution is marked failed. The job id is the execution id, so a slow add that
 * lands late and a retry together still make one job.
 *
 * M9-T21: write to WorkflowTriggerOutbox after schema merge (an in-process retry does not survive a restart).
 */
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { runInTenant } from '../utils/tenantContext';
import { workflowQueue } from './workflowQueue';

export const ENQUEUE_TIMEOUT_MS = 5000;
export const RETRY_DELAY_MS = 30_000;
export const MAX_RETRIES = 3;
export const QUEUE_DOWN_ERROR = 'Workflow queue is unavailable';

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
      workflowQueue.add('execute-workflow', job, { jobId: runJobId(job.executionId) }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('queue add timed out')), ENQUEUE_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function markFailed(job: WorkflowRunJob): Promise<void> {
  const write = () => prisma.workflowExecution.update({
    where: { id: job.executionId },
    data: { status: 'failed', error: QUEUE_DOWN_ERROR, completedAt: new Date() },
  });
  try {
    await (job.tenantId ? runInTenant(job.tenantId, write) : write());
  } catch (error: any) {
    logger.error('Could not mark workflow execution failed', { executionId: job.executionId, error: error.message });
  }
}

function scheduleRetry(job: WorkflowRunJob, attempt: number): void {
  const timer = setTimeout(async () => {
    try {
      await addOnce(job);
      logger.info('Workflow run queued on retry', { executionId: job.executionId, attempt });
    } catch (error: any) {
      logger.warn('Workflow queue retry failed', { executionId: job.executionId, attempt, error: error.message });
      if (attempt < MAX_RETRIES) {
        scheduleRetry(job, attempt + 1);
      } else {
        logger.error('Workflow run dropped: queue unavailable after retries', { executionId: job.executionId });
        await markFailed(job);
      }
    }
  }, RETRY_DELAY_MS);
  timer.unref?.(); // a pending retry never keeps the process alive
}

/** Resolves true when the job was added, false when it was handed to the retry. Never rejects. */
export async function enqueueWorkflowRun(job: WorkflowRunJob): Promise<boolean> {
  try {
    await addOnce(job);
    return true;
  } catch (error: any) {
    logger.warn('Workflow queue unavailable, will retry', { executionId: job.executionId, error: error.message });
    scheduleRetry(job, 1);
    return false;
  }
}
