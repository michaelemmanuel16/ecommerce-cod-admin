import { useBlock } from '../../pages/financial/profit/useBlock';
import { payoutsService } from '../../services/payouts.service';

const HISTORY_ROWS = 10;

/** The latest rep payouts, newest first. One key, so Finance and the Staff pay card share one call and read the same rows. */
export const useRepPayoutHistory = () => useBlock('reps:payouts', () => payoutsService.recentRepPayouts(HISTORY_ROWS));
