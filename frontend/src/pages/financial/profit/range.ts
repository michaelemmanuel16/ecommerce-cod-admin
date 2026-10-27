import { useFinancialStore } from '../../../stores/financialStore';
import { todayYmd } from '../../../utils/format';
import { asDay } from '../overview/model';

export interface FinanceRange { from: string; to: string }

/**
 * The Finance date control as store days (YYYY-MM-DD), or this month to today when none is chosen (the Reports "This month" preset
 * does the same). The store can hold an end of day as an instant; every screen and request gets the day.
 */
export function useFinanceRange(): FinanceRange {
  const { startDate, endDate } = useFinancialStore((s) => s.dateRange);
  const today = todayYmd();
  return { from: startDate ? asDay(startDate) : `${today.slice(0, 7)}-01`, to: endDate ? asDay(endDate) : today };
}
