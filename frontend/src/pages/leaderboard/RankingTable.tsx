import clsx from 'clsx';
import { Card, Table, Tag, type Column } from '../../components/ui-v2';
import type { BoardRole, BoardRow } from '../../services/leaderboard.service';
import { initials } from '../dashboard/format';
import { avatarTone, kindTag, pct, reasonLabel } from './model';

/** The percent of target with its bar (role="progressbar"); an unranked row says why instead of a number. */
function OfTarget({ row }: { row: BoardRow }) {
  if (row.percent === null || !row.ranked) {
    return <span className="lb-reason">{reasonLabel(row)}</span>;
  }
  return (
    <div className="pct">
      <div className="prog" role="progressbar" aria-label={`${row.name} of target`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(row.percent)}>
        <i style={{ width: `${Math.min(row.percent, 100)}%` }} />
      </div>
      <b className="num">{pct(row.percent)}</b>
    </div>
  );
}

function columns(role: BoardRole): Column<BoardRow>[] {
  const who: Column<BoardRow> = {
    key: 'who',
    header: role === 'call_rep' ? 'Staff' : 'Agent',
    render: (r) => {
      const tag = kindTag(r.kind);
      return (
        <div className="who">
          <div className={clsx('a', avatarTone(r.kind, r.userId))}>{initials(r.name)}</div>
          <div>
            {r.name}
            {tag && <Tag tone={r.kind === 'ai_agent' ? 'v' : 'n'}>{tag}</Tag>}
            {r.flag === 'contract_review' && <Tag tone="n">{r.flagText ?? 'Contract review'}</Tag>}
            <small>{r.roleName}</small>
          </div>
        </div>
      );
    },
  };
  const rank: Column<BoardRow> = {
    key: 'rank',
    header: 'Rank',
    render: (r) => (r.rank === null ? <div className="rank" aria-label="Not ranked">–</div> : <div className={clsx('rank', r.rank === 1 && 'first')} aria-label={`Rank ${r.rank}`}>{r.rank}</div>),
  };
  const ofTarget: Column<BoardRow> = {
    key: 'target',
    header: role === 'call_rep' ? <>Of role target<small className="lb-sub">confirmed and delivered</small></> : 'Of target',
    width: '24%',
    render: (r) => <OfTarget row={r} />,
  };
  return role === 'call_rep'
    ? [
      rank, who, ofTarget,
      { key: 'confirmed', header: 'Confirmed', right: true, render: (r) => <span className="num"><b>{r.confirmed ?? '—'}</b></span> },
      { key: 'rate', header: 'Confirmation rate', right: true, render: (r) => pct(r.confirmationRate) },
      { key: 'dfc', header: 'Delivered from confirmed', right: true, render: (r) => pct(r.deliveredFromConfirmed) },
    ]
    : [
      rank, who, ofTarget,
      { key: 'success', header: 'Success', right: true, render: (r) => pct(r.success) },
      { key: 'days', header: 'Days to pay', right: true, render: (r) => (r.daysToPay === null || r.daysToPay === undefined ? '—' : r.daysToPay) },
      { key: 'delivered', header: 'Delivered', right: true, render: (r) => <span className="num">{r.delivered ?? 0}</span> },
    ];
}

/** The full ranking (F-1104, F-1105). The API sends the ranked rows first; people with no target or "Too early" follow. */
export function RankingTable({ role, rows, period, ownOnly }: { role: BoardRole; rows: BoardRow[]; period: string; ownOnly: boolean }) {
  const title = ownOnly ? 'Your rank' : role === 'call_rep' ? 'Full ranking: call reps' : 'Full ranking: delivery';
  return (
    <Card title={title} aside={period}>
      {rows.length === 0 ? (
        <p className="emptyrow">{ownOnly ? 'You are not on this board.' : 'No one holds this role yet.'}</p>
      ) : (
        <Table label={title} columns={columns(role)} rows={rows} rowKey={(r) => `${r.userId}-${r.roleId}`} className="lb-table" />
      )}
    </Card>
  );
}
