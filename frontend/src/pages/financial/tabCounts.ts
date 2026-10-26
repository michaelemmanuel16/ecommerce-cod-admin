import apiClient from '../../services/api';
import { payoutsService } from '../../services/payouts.service';
import { useBlock } from './profit/useBlock';

/** Deposits waiting to be verified: the same list the Review collection modal works through (GET /api/agent-reconciliation/deposits?status=pending). */
const pendingDeposits = async (): Promise<number> => {
  const { data } = await apiClient.get<unknown[]>('/api/agent-reconciliation/deposits', { params: { status: 'pending' }, quiet: true });
  return data.length;
};

/** The count pills of the Finance tab bar. A number that cannot load is left out, never shown as 0. */
export function useTabCounts(canSeeReps: boolean): { collections: number | undefined; reps: number | undefined } {
  const deposits = useBlock('tabcount:pending-deposits', pendingDeposits);
  const reps = useBlock(`tabcount:reps-owed:${canSeeReps}`, () => (canSeeReps ? payoutsService.repsOwed().then((r) => r.totals.repsOwed) : Promise.resolve(0)));
  return {
    collections: deposits.status === 'ready' ? deposits.data : undefined,
    reps: canSeeReps && reps.status === 'ready' ? reps.data : undefined,
  };
}
