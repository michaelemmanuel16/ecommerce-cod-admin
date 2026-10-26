import { useFinancialStore } from '../../../stores/financialStore';
import { todayYmd } from '../../../utils/format';

export interface FinanceRange { from: string; to: string }

/** The Finance date control, or this month to today when none is chosen (the Reports "This month" preset does the same). */
export function useFinanceRange(): FinanceRange {
  const { startDate, endDate } = useFinancialStore((s) => s.dateRange);
  const today = todayYmd();
  return { from: startDate ?? `${today.slice(0, 7)}-01`, to: endDate ?? today };
}
