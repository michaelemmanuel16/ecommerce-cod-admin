import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Download, ExternalLink, FileSpreadsheet, FileText } from 'lucide-react';
import { useToast } from '../../../components/ui-v2';
import { usePopover } from '../../../components/shell/usePopover';
import { financeReportsService, type ExportFormat, type ExportReport } from '../../../services/financeReports.service';
import { apiMessage, saveBlob } from '../../orders/importText';
import { useFinanceRange } from '../profit/range';

const ITEMS: Array<{ report: ExportReport; format: ExportFormat; label: string; note: string; icon: typeof FileText }> = [
  { report: 'profit-loss', format: 'csv', label: 'Profit and loss', note: 'CSV, for the dates above', icon: FileText },
  { report: 'agent-aging', format: 'csv', label: 'Agent aging and collections', note: 'CSV, as it stands today', icon: FileText },
  { report: 'general-ledger', format: 'csv', label: 'General ledger', note: 'CSV, for the dates above', icon: FileText },
  { report: 'cash-flow', format: 'csv', label: 'Cash-flow forecast', note: 'CSV, next 30 days', icon: FileText },
  { report: 'profit-loss', format: 'xlsx', label: 'Profit and loss', note: 'Excel, for the dates above', icon: FileSpreadsheet },
];

/**
 * The Export menu of the Finance header (F-930, M5-T41): four CSV files and the profit and loss as Excel, each a real file from
 * GET /api/financial/export/:report, named by the server with its range. "More in Reports" opens Products and profit.
 */
export function ExportMenu() {
  const menu = usePopover();
  const say = useToast();
  const { from, to } = useFinanceRange();
  const [busy, setBusy] = useState(false);

  const run = async (report: ExportReport, format: ExportFormat) => {
    menu.close();
    setBusy(true);
    try {
      const { blob, filename } = await financeReportsService.exportFile(
        report, { format, startDate: report === 'profit-loss' || report === 'general-ledger' ? from : undefined, endDate: report === 'profit-loss' || report === 'general-ledger' ? to : undefined },
        { onQueued: () => say('The ledger is large. It is being prepared.') },
      );
      saveBlob(blob, filename);
      say(`Downloaded ${filename}`);
    } catch (err) {
      say(await apiMessage(err, 'The file could not be exported. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mwrap" ref={menu.wrapRef}>
      <button ref={menu.triggerRef} type="button" className="btn" aria-haspopup="menu" aria-expanded={menu.open} disabled={busy} onClick={menu.toggle}>
        <Download />
        Export
        <ChevronDown style={{ width: 15, height: 15 }} />
      </button>
      {menu.open && (
        <div className="menu" role="menu" aria-label="Export">
          {ITEMS.map((i) => (
            <button key={`${i.report}-${i.format}`} type="button" role="menuitem" onClick={() => void run(i.report, i.format)}>
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
