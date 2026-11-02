import { Crown } from 'lucide-react';
import clsx from 'clsx';
import { Tag } from '../../components/ui-v2';
import type { BoardRole, BoardRow } from '../../services/leaderboard.service';
import { initials } from '../dashboard/format';
import { avatarTone, kindTag, ordinal, pct } from './model';

function stats(role: BoardRole, row: BoardRow): Array<[string, string]> {
  return role === 'call_rep'
    ? [['Of target', pct(row.percent)], ['Confirmed', String(row.confirmed ?? '—')], ['Confirmation', pct(row.confirmationRate)]]
    : [['Of target', pct(row.percent)], ['Success', pct(row.success)], ['Delivered', String(row.delivered ?? '—')]];
}

/** The top three ranked rows (F-1104, F-1105): 2nd, 1st, 3rd as in the mockup. Tied rows each show their own rank. */
export function Podium({ role, rows }: { role: BoardRole; rows: BoardRow[] }) {
  const top = rows.filter((r) => r.rank !== null).slice(0, 3);
  if (top.length === 0) return null;
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top;
  return (
    <div className="podium" aria-label="Podium">
      {order.map((row) => {
        const first = row.rank === 1;
        const tag = kindTag(row.kind);
        return (
          <div key={`${row.userId}-${row.roleId}`} className={clsx('p', first && 'first')}>
            {first && <span className="crown" aria-hidden><Crown size={18} /></span>}
            <div className="place">{ordinal(row.rank!)}</div>
            <div className={clsx('face', avatarTone(row.kind, 0))} aria-hidden>{initials(row.name)}</div>
            <h3>{row.name}</h3>
            <div className="role">{row.roleName}{tag && <> <Tag tone={row.kind === 'ai_agent' ? 'v' : 'n'}>{tag}</Tag></>}</div>
            <div className="stats">
              {stats(role, row).map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b></div>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
