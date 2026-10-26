import { Link } from 'react-router-dom';
import { ChevronDown, Download, ExternalLink, FileSpreadsheet, FileText } from 'lucide-react';
import { usePopover } from '../../../components/shell/usePopover';
import { financeReportsService, type ExportFormat, type ExportReport } from '../../../services/financeReports.service';
import { useDownload } from './useDownload';
import { useFinanceRange } from '../profit/range';

/** `ranged`: the file takes the Finance dates. The others are a snapshot of today or of the next 30 days. */
const ITEMS: Array<{ report: ExportReport; format: ExportFormat; label: string; note: string; icon: typeof FileText; ranged: boolean }> = [
  { report: 'profit-loss', format: 'csv', label: 'Profit and loss', note: 'CSV, for the dates above', icon: FileText, ranged: true },
  { report: 'agent-aging', format: 'csv', label: 'Agent aging and collections', note: 'CSV, as it stands today', icon: FileText, ranged: false },
  { report: 'general-ledger', format: 'csv', label: 'General ledger', note: 'CSV, for the dates above', icon: FileText, ranged: true },
  { report: 'cash-flow', format: 'csv', label: 'Cash-flow forecast', note: 'CSV, next 30 days', icon: FileText, ranged: false },
  { report: 'profit-loss', format: 'xlsx', label: 'Profit and loss', note: 'Excel, for the dates above', icon: FileSpreadsheet, ranged: true },
];

/**
 * The Export menu of the Finance header (F-930, M5-T41): four CSV files and the profit and loss as Excel, each a real file from
 * GET /api/financial/export/:report, named by the server with its range. "More in Reports" opens Products and profit.
 */
export function ExportMenu() {
  const menu = usePopover();
  const { from, to } = useFinanceRange();
  const download = useDownload();

  const run = (item: (typeof ITEMS)[number]) => {
    menu.close();
    const range = item.ranged ? { startDate: from, endDate: to } : {};
    void download.run(
      () => financeReportsService.exportFile(item.report, { format: item.format, ...range }, { onQueued: () => download.say('The ledger is large. It is being prepared.') }),
      'The file could not be exported. Try again.',
    );
  };

  return (
    <div className="mwrap" ref={menu.wrapRef}>
      <button ref={menu.triggerRef} type="button" className="btn" aria-haspopup="menu" aria-expanded={menu.open} disabled={download.busy} onClick={menu.toggle}>
        <Download />
        Export
        <ChevronDown style={{ width: 15, height: 15 }} />
      </button>
      {menu.open && (
        <div className="menu" role="menu" aria-label="Export">
          {ITEMS.map((i) => (
            <button key={`${i.report}-${i.format}`} type="button" role="menuitem" onClick={() => run(i)}>
              <i.icon />
              <span>{i.label}<small>{i.note}</small></span>
            </button>
          ))}
          <hr />
          <Link role="menuitem" to="/reports?tab=products" onClick={menu.close}>
            <ExternalLink />
            More in Reports
          </Link>
        </div>
      )}
    </div>
  );
}
