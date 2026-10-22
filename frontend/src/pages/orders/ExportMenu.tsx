import { useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useToast } from '../../components/ui-v2';
import { usePopover } from '../../components/shell/usePopover';
import { ordersService, type OrderListParams } from '../../services/orders.service';
import { apiMessage, ordersPhrase } from './importText';

interface ExportMenuProps {
  /** The list's current filters: the file holds every order the list would show. */
  params: OrderListParams;
  /** How many orders the list shows, for the toast. */
  total: number;
}

/** The Export button and its small format menu (M3-T48, F-320): CSV or Excel, named orders-<date>. */
export function ExportMenu({ params, total }: ExportMenuProps) {
  const menu = usePopover();
  const say = useToast();
  const [busy, setBusy] = useState(false);

  const run = async (format: 'csv' | 'xlsx') => {
    menu.close();
    setBusy(true);
    try {
      const name = await ordersService.exportList(params, format);
      say(`Exported ${ordersPhrase(total)} to ${name}`);
    } catch (err) {
      say(await apiMessage(err, 'The orders could not be exported. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mwrap" ref={menu.wrapRef}>
      <button ref={menu.triggerRef} type="button" className="btn" aria-haspopup="menu" aria-expanded={menu.open} disabled={busy} onClick={menu.toggle}>
        <Download />
        Export
      </button>
      {menu.open && (
        <div className="menu" role="menu" aria-label="Export format">
          <button type="button" role="menuitem" onClick={() => void run('csv')}>
            <FileText />
            CSV
          </button>
          <button type="button" role="menuitem" onClick={() => void run('xlsx')}>
            <FileSpreadsheet />
            Excel (.xlsx)
          </button>
        </div>
      )}
    </div>
  );
}
