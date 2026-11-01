import { useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { FloatingMenu } from '../orders/FloatingMenu';
import type { StaffRow } from '../../services/staff.service';

export type RowAction = 'edit' | 'payout' | 'key' | 'reset' | 'resend' | 'revoke' | 'deactivate' | 'reactivate' | 'delete' | 'restore' | 'erase';

interface RowMenuProps {
  row: StaffRow;
  /** What this viewer may do. */
  can: { update: boolean; delete: boolean; erase: boolean };
  onAction: (action: RowAction, row: StaffRow) => void;
}

/** The actions of a row (F-1160, F-1165): which ones show depends on the person's status and kind. */
export function actionsOf(row: StaffRow, can: RowMenuProps['can']): Array<{ action: RowAction; label: string; danger?: boolean }> {
  const out: Array<{ action: RowAction; label: string; danger?: boolean }> = [];
  const human = row.kind === 'person';
  if (row.status === 'deleted') {
    if (can.update) out.push({ action: 'restore', label: 'Restore' });
    if (can.erase) out.push({ action: 'erase', label: 'Delete for good', danger: true });
    return out;
  }
  if (can.update) out.push({ action: 'edit', label: 'Edit' });
  if (can.update && row.status === 'invited') {
    out.push({ action: 'resend', label: 'Resend invite' }, { action: 'revoke', label: 'Revoke invite' });
  }
  const paid = human && (row.feeRule !== null || row.payMethod === 'per_order' || (row.payMethod === null && row.role === 'sales_rep'));
  if (can.update && paid && row.status === 'active') out.push({ action: 'payout', label: 'Record payout' });
  if (can.update && row.status === 'active') {
    if (row.kind === 'ai_agent') out.push({ action: 'key', label: 'Manage key' });
    else if (human) out.push({ action: 'reset', label: 'Reset password' });
  }
  if (can.update && row.status === 'active') out.push({ action: 'deactivate', label: 'Deactivate' });
  if (can.update && row.status === 'deactivated') out.push({ action: 'reactivate', label: 'Reactivate' });
  if (can.delete && row.status !== 'invited') out.push({ action: 'delete', label: 'Delete', danger: true });
  return out;
}

/** The "..." button of a row and its menu (the mockup's .rmenu), a FloatingMenu so the table's scroll box cannot clip it. */
export function RowMenu({ row, can, onAction }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = actionsOf(row, can);
  if (items.length === 0) return null;
  return (
    <>
      <button ref={trigger} type="button" className="kb" aria-label={`Actions for ${row.name}`} aria-haspopup="menu" aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        <MoreHorizontal />
      </button>
      {open && trigger.current && (
        <FloatingMenu anchor={trigger.current} label={`Actions for ${row.name}`} width={210} onClose={() => setOpen(false)}>
          {items.map((i) => (
            <button key={i.action} type="button" role="menuitem" className={i.danger ? 'dng' : undefined} onClick={() => { setOpen(false); onAction(i.action, row); }}>
              {i.label}
            </button>
          ))}
        </FloatingMenu>
      )}
    </>
  );
}
