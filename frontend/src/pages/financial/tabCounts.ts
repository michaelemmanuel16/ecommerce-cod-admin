import { pendingOf } from './collections/model';
import { useDeposits, useRepsOwedCount } from './profit/blocks';

/** The count pills of the Finance tab bar. The pay-ins are the answer the Agent collections tab uses, so no call is made twice; the reps owed come from a count-only call, so the whole Rep commissions table loads only on its own tab. A number that cannot load is left out, never shown as 0. */
export function useTabCounts(canSeeReps: boolean): { collections: number | undefined; reps: number | undefined } {
  const deposits = useDeposits();
  const reps = useRepsOwedCount(canSeeReps);
  return {
    // Deposits waiting to be verified: the same list the Review collection modal works through
    collections: deposits.status === 'ready' && deposits.data ? pendingOf(deposits.data).length : undefined,
    reps: reps.status === 'ready' && reps.data !== undefined ? reps.data : undefined,
  };
}
