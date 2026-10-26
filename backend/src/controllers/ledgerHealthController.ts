import { Response } from 'express';
import { AuthRequest } from '../types';
import { runFinanceHealth } from '../services/financeHealthService';
import { enqueueFinanceJob } from '../queues/financeJobQueue';
import { getTenantId } from '../utils/tenantContext';
import logger from '../utils/logger';

/** A check that takes longer than this runs as a job (F-931). Read on each call so a test can shorten it. */
const inlineLimitMs = () => Number(process.env.FINANCE_HEALTH_INLINE_MS) || 30_000;

/**
 * GET /api/financial/health
 * Every finance rule with its count, the failures, GL balance integrity and the last order-versus-ledger run
 * (M1-T28, M5-T29). When the check takes over 30 seconds the answer is 202 with a job id; read it at
 * GET /api/financial/jobs/:id.
 */
export const getFinancialHealth = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const check = runFinanceHealth();
    check.catch(() => undefined); // if the job answer wins the race, a late failure here is not unhandled
    let timer: NodeJS.Timeout | undefined;
    const tooSlow = new Promise<'slow'>((resolve) => { timer = setTimeout(() => resolve('slow'), inlineLimitMs()); });
    const first = await Promise.race([check, tooSlow]);
    clearTimeout(timer);

    if (first === 'slow') {
      const jobId = await enqueueFinanceJob('health-check', { tenantId: getTenantId()!, userId: req.user!.id });
      res.status(202).json({ jobId, status: 'queued', statusUrl: `/api/financial/jobs/${jobId}` });
      return;
    }
    res.json(first);
  } catch (error) {
    logger.error('Failed to fetch financial health', { error });
    res.status(500).json({ message: 'Failed to fetch financial health' });
  }
};
