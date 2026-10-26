import { Response } from 'express';
import { AuthRequest } from '../types';
import { enqueueFinanceJob, getFinanceJob } from '../queues/financeJobQueue';
import { getTenantId } from '../utils/tenantContext';
import logger from '../utils/logger';

/** How long the request waits for the check before it answers with a job id (F-931). Read on each call so a test can shorten it. */
const waitMs = () => Number(process.env.FINANCE_HEALTH_INLINE_MS) || 30_000;
const POLL_MS = 100;

/**
 * GET /api/financial/health
 * Every finance rule with its count, the failures, GL balance integrity and the last order-versus-ledger run
 * (M1-T28, M5-T29). The check runs once, as a finance job. The request waits up to 30 seconds for it: a finished
 * check is the 200 answer; otherwise the answer is 202 with the job id, read at GET /api/financial/jobs/:id.
 */
export const getFinancialHealth = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const jobId = await enqueueFinanceJob('health-check', { tenantId: getTenantId()! });
    const deadline = Date.now() + waitMs();
    do {
      const job = await getFinanceJob(jobId);
      if (job?.status === 'done') { res.json(job.result); return; }
      if (job?.status === 'failed') throw new Error(job.error ?? 'Health check job failed');
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    } while (Date.now() < deadline);
    res.status(202).json({ jobId, status: 'queued', statusUrl: `/api/financial/jobs/${jobId}` });
  } catch (error) {
    logger.error('Failed to fetch financial health', { error });
    res.status(500).json({ message: 'Failed to fetch financial health' });
  }
};
