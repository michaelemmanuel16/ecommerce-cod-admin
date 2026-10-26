import { financeReportsService, type ExportFormat, type ExportReport } from '../../../services/financeReports.service';
import { useDownload } from './useDownload';
import { useFinanceRange } from '../profit/range';

/** `ranged`: the file takes the Finance dates. The others are a snapshot of today or of the next 30 days. */
export const ITEMS: Array<{ id: string; report: ExportReport; format: ExportFormat; label: string; note: string; ranged: boolean }> = [
  { id: 'profit-loss-csv', report: 'profit-loss', format: 'csv', label: 'Profit and loss', note: 'CSV', ranged: true },
  { id: 'agent-aging-csv', report: 'agent-aging', format: 'csv', label: 'Agent aging and collections', note: 'CSV', ranged: false },
  { id: 'general-ledger-csv', report: 'general-ledger', format: 'csv', label: 'General ledger', note: 'CSV', ranged: true },
  { id: 'cash-flow-csv', report: 'cash-flow', format: 'csv', label: 'Cash-flow forecast', note: 'CSV', ranged: false },
  // not in the mockup: kept because M5-T41 asks for the profit and loss as Excel
  { id: 'profit-loss-xlsx', report: 'profit-loss', format: 'xlsx', label: 'Profit and loss', note: 'Excel', ranged: true },
];

export type ExportItem = (typeof ITEMS)[number];
export const PROFIT_LOSS_CSV = ITEMS.find((i) => i.id === 'profit-loss-csv')!;

/** Runs one Finance export as a real file: the ranged ones take the Finance dates. Shared by the header menu and the P&L card. */
export function useFinanceExport() {
  const { from, to } = useFinanceRange();
  const download = useDownload();
  const run = (item: ExportItem) => {
    const range = item.ranged ? { startDate: from, endDate: to } : {};
    void download.run(
      () => financeReportsService.exportFile(item.report, { format: item.format, ...range }, { onQueued: () => download.say('The ledger is large. It is being prepared.') }),
      'The file could not be exported. Try again.',
    );
  };
  return { run, busy: download.busy };
}
