import { Banknote, Sun } from 'lucide-react';
import clsx from 'clsx';
import { Card, Tag } from '../../components/ui-v2';
import { formatCurrency } from '../../utils/format';
import type { Board, BoardRow } from '../../services/leaderboard.service';
import { initials } from '../dashboard/format';
import { avatarTone } from './model';

/** The tag at the end of a progress row: the cash the person earns or is on track for, "Review" for the contract flag, else nothing to pay. */
function rowTag(row: BoardRow, currency: string): { text: string; tone: 'ok' | 'n' } {
  if (row.flag === 'contract_review') return { text: 'Review', tone: 'n' };
  if (!row.payout || !row.ranked) return { text: 'None', tone: 'n' };
  if (row.reward) return { text: formatCurrency(row.reward.amount, currency), tone: 'ok' };
  return { text: row.tier === 'none' ? 'To earn' : 'None', tone: row.tier === 'none' ? 'ok' : 'n' };
}

/** What the row says under the name. Not ranked people say why; flagged companies carry the contract review wording of the API. */
function rowText(row: BoardRow): string {
  if (row.flag === 'contract_review') return `${row.flagText ?? 'Contract review'}. Companies get no bonus`;
  if (!row.ranked && row.reason) {
    if (row.reason === 'Too early') return 'No closed orders yet. Too early to rank';
    const why = row.reason === 'Set a target' ? 'No target' : row.reason;
    return row.payout ? why : `${why}. No payout`;
  }
  return row.message ?? '';
}

/** Rewards and the distance to the next cash tier (F-1104, F-1105, F-1108). Month and year only: the API sends `rewards` null for a day or a week. */
export function RewardsCard({ board }: { board: Board }) {
  if (!board.rewards) return null;
  const tiers = board.rewards.tiers[0];
  const tier = (t: typeof tiers.tier100, label: string, icon: JSX.Element, tone: string) => (
    <div className="reward">
      <div className={clsx('ico', tone)} aria-hidden>{icon}</div>
      <div>
        <b>{label}</b>
        <small>{t ? `${formatCurrency(t.amount, board.currency)}${t.dayOff ? ' + paid day off' : ' bonus'}` : 'Not set'}</small>
      </div>
    </div>
  );
  return (
    <Card title="Rewards" aside={board.period.label}>
      <div className="lb-tiers">
        {tier(tiers?.tier100 ?? null, '100% of target', <Banknote size={18} />, 'violet')}
        {tier(tiers?.tier120 ?? null, '120% of target', <Sun size={18} />, 'mint')}
      </div>
      <div className="dist">
        <h4>Distance to the next tier</h4>
        {board.rows.map((row, i) => {
          const tag = rowTag(row, board.currency);
          return (
            <div className="row" key={`${row.userId}-${row.roleId}`}>
              <div className={clsx('a', avatarTone(row.kind, i))}>{initials(row.name)}</div>
              <div><b>{row.name}</b><small>{rowText(row)}</small></div>
              <Tag tone={tag.tone}>{tag.text}</Tag>
            </div>
          );
        })}
        {board.rows.length === 0 && <p className="emptyrow">Nothing to show yet.</p>}
        <p className="lb-nopay">AI agents and companies get no payout.</p>
      </div>
    </Card>
  );
}
