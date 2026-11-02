import { Link } from 'react-router-dom';
import { Table, Tag, type Column } from '../../components/ui-v2';
import { avatarClass, initials } from '../../utils/people';
import type { StaffRow } from '../../services/staff.service';
import { RowMenu, type RowAction } from './RowMenu';
import { contactOf, lastActiveText, payText, STATUS_LABEL, STATUS_TONE, TYPE_LABEL, TYPE_TONE } from './model';

interface TeamTableProps {
  rows: StaffRow[];
  company: { baseCommission: number; upsellPercent: number } | null;
  currency: string;
  can: { update: boolean; delete: boolean; erase: boolean };
  onAction: (action: RowAction, row: StaffRow) => void;
}

/** The team table (F-1157): Name with contact, Roles, Type, Pay, Last active, Status and the row menu. */
export function TeamTable({ rows, company, currency, can, onAction }: TeamTableProps) {
  const columns: Column<StaffRow>[] = [
    {
      key: 'name', header: 'Name',
      render: (p) => (
        <div className="who">
          <div className={avatarClass(p.kind === 'company' ? 'company' : 'person', p.id)} aria-hidden="true">{initials(p.name)}</div>
          <div>
            <b>{p.name}</b>
            <small>{contactOf(p)}</small>
          </div>
        </div>
      ),
    },
    {
      key: 'roles', header: 'Roles',
      render: (p) => <div className="rolechips">{p.positions.length ? p.positions.map((r) => <Tag key={r.id}>{r.name}</Tag>) : <span className="mut">—</span>}</div>,
    },
    { key: 'type', header: 'Type', render: (p) => <Tag tone={TYPE_TONE[p.kind]}>{TYPE_LABEL[p.kind]}</Tag> },
    {
      key: 'pay', header: 'Pay',
      render: (p) => {
        const text = payText(p, company, currency);
        return p.feeRule ? <Link to={`/deliveries?partner=${p.id}`}>{text}</Link> : text;
      },
    },
    { key: 'last', header: 'Last active', render: (p) => lastActiveText(p) },
    { key: 'status', header: 'Status', render: (p) => <Tag tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Tag> },
    { key: 'menu', header: <span className="sr-only">Actions</span>, right: true, render: (p) => <RowMenu row={p} can={can} onAction={onAction} /> },
  ];
  return <Table label="Team" className="tt2" columns={columns} rows={rows} rowKey={(p) => p.id} rowClass={(p) => (p.status === 'deactivated' || p.status === 'deleted' ? 'off' : undefined)} />;
}
