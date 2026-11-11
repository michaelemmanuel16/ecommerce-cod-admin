import logger from '../../utils/logger';
import { pullAccount } from './metaInsightsService';
import { postMetaSpend } from './metaLedgerService';
import { safeErrorMessage } from '../../utils/safeError';


/**
 * Pull the last 3 days of one ad account, then post the spend of those days to the ledger.
 * Run inside the tenant context. Returns the dates pulled ([] when the account was skipped or the pull failed).
 * A ledger failure is logged and does not fail the pull (the next run posts the difference).
 */
export async function runAccountPull(adAccountId: number): Promise<string[]> {
  const dates = await pullAccount(adAccountId, 3);
  if (dates.length === 0) return dates;
  try {
    await postMetaSpend(adAccountId, dates);
  } catch (err: any) {
    logger.error('Meta spend ledger posting failed', { adAccountId, error: safeErrorMessage(err) });
  }
  return dates;
}
