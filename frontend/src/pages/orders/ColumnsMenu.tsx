import { Check, Columns3 } from 'lucide-react';
import { usePopover } from '../../components/shell/usePopover';
import { COLUMN_LABELS } from './labels';
import { FIXED_COLUMNS, type ColumnId } from './useColumnPrefs';

/** The column menu (F-307): turns the optional columns on and off. Order, select and Assign always show. */
export function ColumnsMenu({ hidden, onToggle }: { hidden: ColumnId[]; onToggle: (id: ColumnId) => void }) {
  const menu = usePopover();
  return (
    <div className="mwrap" ref={menu.wrapRef}>
      <button ref={menu.triggerRef} type="button" className="btn" aria-haspopup="menu" aria-expanded={menu.open} onClick={menu.toggle}>
        <Columns3 />
        Columns
      </button>
      {menu.open && (
        <div className="menu" role="menu" aria-label="Columns">
          {(Object.keys(COLUMN_LABELS) as ColumnId[])
            .filter((id) => !FIXED_COLUMNS.includes(id))
            .map((id) => (
              <button key={id} type="button" role="menuitemcheckbox" aria-checked={!hidden.includes(id)} onClick={() => onToggle(id)}>
                {COLUMN_LABELS[id]}
                {!hidden.includes(id) && <Check className="cur" aria-hidden="true" />}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
