import { Link } from 'react-router-dom';
import { BarChart3, ChevronDown, Download, FileSpreadsheet, FileText } from 'lucide-react';
import { usePopover } from '../../../components/shell/usePopover';
import { ITEMS, useFinanceExport, type ExportItem } from './useFinanceExport';

/**
 * The Export menu of the Finance header (F-930, M5-T41, finance.html .menuwrap): four CSV files, each a real file from
 * GET /api/financial/export/:report, named by the server with its range. "More in Reports" opens Products and profit,
 * where Excel and any dates are available.
 */
export function ExportMenu() {
  const menu = usePopover();
  const exporter = useFinanceExport();

  const run = (item: ExportItem) => {
    menu.close();
    exporter.run(item);
  };

  return (
    <div className="mwrap" ref={menu.wrapRef}>
      <button ref={menu.triggerRef} type="button" className="btn pri" aria-haspopup="menu" aria-expanded={menu.open} disabled={exporter.busy} onClick={menu.toggle}>
        <Download />
        Export
        <ChevronDown />
      </button>
      {menu.open && (
        <div className="menu" role="menu" aria-label="Export">
          {ITEMS.map((i) => (
            <button key={`${i.report}-${i.format}`} type="button" role="menuitem" className="mi" onClick={() => run(i)}>
              {i.excel ? <FileSpreadsheet /> : <FileText />}
              <span>{i.label}<small>{i.note}</small></span>
            </button>
          ))}
          <hr />
          <Link role="menuitem" className="mi" to="/reports?tab=products" onClick={menu.close}>
            <BarChart3 />
            <span>More in Reports<small>CSV and Excel, any dates</small></span>
          </Link>
        </div>
      )}
    </div>
  );
}
