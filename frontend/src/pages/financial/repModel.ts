import type { RepOwedRow } from '../../services/payouts.service';
import { toCents } from '../../utils/money';

/** The tile figures of the Rep commissions tab that the server's totals do not carry, summed in whole cents so nothing drifts. */
export function repTiles(reps: RepOwedRow[]): { perOrder: number | null; targetRewards: number; repsPaid: number } {
  const commission = reps.reduce((sum, r) => sum + toCents(r.commission), 0);
  const delivered = reps.reduce((sum, r) => sum + r.delivered, 0);
  return {
    // Average commission per delivered order, from the commission column and the delivered count of the same rows
    perOrder: delivered > 0 ? commission / 100 / delivered : null,
    targetRewards: reps.reduce((sum, r) => sum + toCents(r.targetReward), 0) / 100,
    repsPaid: reps.filter((r) => toCents(r.paidInMonth) > 0).length,
  };
}
