import { pendingOf } from './collections/model';
import { useDeposits, useRepsOwed } from './profit/blocks';

/** The count pills of the Finance tab bar, read from the same answers as the tabs, so no call is made twice. A number that cannot load is left out, never shown as 0. */
export function useTabCounts(canSeeReps: boolean): { collections: number | undefined; reps: number | undefined } {
  const deposits = useDeposits();
  const reps = useRepsOwed(canSeeReps);
  return {
    // Deposits waiting to be verified: the same list the Review collection modal works through
    collections: deposits.status === 'ready' && deposits.data ? pendingOf(deposits.data).length : undefined,
    reps: reps.status === 'ready' && reps.data ? reps.data.totals.repsOwed : undefined,
  };
}
