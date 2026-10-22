import { useState } from 'react';
import { Archive, ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useToast } from '../../components/ui-v2';
import { usePopover } from '../../components/shell/usePopover';
import { reportsService, type ExportFormat } from '../../services/reports.service';
import { apiMessage } from '../orders/importText';
import type { TabKey } from './tabs';
import type { ReportParams, ReportTabId } from './types';

/** The tabs the export endpoint can write. Products and Marketing come in later milestones and have no "this tab" items. */
const EXPORTABLE: TabKey[] = ['overview', 'sales', 'delivery', 'team'];

interface ExportSlotProps {
  /** The tab that is open. */
  tab: TabKey;
  /** The range on screen and the compare switch. */
  params: ReportParams;
}

/**
 * The Export menu of the header (F-1057, mockup #exportMenu): CSV and Excel for the open tab, and every report as one
 * Excel file. No PDF, no custom export, no saved reports. The file is named by the server.
 */
export function ExportSlot({ tab, params }: ExportSlotProps) {
  const menu = usePopover();
  const say = useToast();
  const [busy, setBusy] = useState(false);

  const run = async (which: ReportTabId | 'all', format: ExportFormat) => {
    menu.close();
    setBusy(true);
    try {
      const name = await reportsService.download(which, params, format);
      say(`Downloaded ${name}`);
    } catch (err) {
      say(await apiMessage(err, 'The report could not be exported. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mwrap" ref={menu.wrapRef}>
      <button ref={menu.triggerRef} type="button" className="btn pri" aria-haspopup="menu" aria-expanded={menu.open} disabled={busy} onClick={menu.toggle}>
        <Download />
        Export
        <ChevronDown style={{ width: 15, height: 15 }} />
      </button>
      {menu.open && (
        <div className="menu" role="menu" aria-label="Export">
          {EXPORTABLE.includes(tab) && (
            <>
              <button type="button" role="menuitem" onClick={() => void run(tab as ReportTabId, 'csv')}>
                <FileText />
                CSV (this tab)
              </button>
              <button type="button" role="menuitem" onClick={() => void run(tab as ReportTabId, 'xlsx')}>
                <FileSpreadsheet />
                Excel (this tab)
              </button>
              <hr />
            </>
          )}
          <button type="button" role="menuitem" onClick={() => void run('all', 'xlsx')}>
            <Archive />
            Download all reports (Excel)
          </button>
        </div>
      )}
    </div>
  );
}
