import { CalendarCheck, Lock, ShieldCheck, Star, TrendingUp } from 'lucide-react';
import clsx from 'clsx';
import { Card } from '../../components/ui-v2';
import type { BadgeList } from '../../services/leaderboard.service';
import { MONTHS } from '../dashboard/format';

const ICON: Record<string, { icon: JSX.Element; tone: string }> = {
  top_of_month: { icon: <Star size={20} />, tone: 'pine' },
  hit_target_3_months: { icon: <CalendarCheck size={20} />, tone: 'mint' },
  beat_target_20: { icon: <TrendingUp size={20} />, tone: 'mint' },
  zero_unpaid_8_days: { icon: <ShieldCheck size={20} />, tone: 'gold' },
};

/** "September" for 2026-09 inside the year shown; "September 2025" otherwise. */
const monthLabel = (period: string, year: string) => {
  const [y, m] = period.split('-');
  return y === year ? MONTHS[Number(m) - 1] : `${MONTHS[Number(m) - 1]} ${y}`;
};

/**
 * Result badges (F-1109): every badge with its holders and month, or "Locked, no one yet". Holders are the people on this board.
 * `userIds` limits the holders to the rows of the tab, as the API lists every role.
 */
export function BadgesCard({ list, userIds, year }: { list: BadgeList; userIds: Set<number>; year: string }) {
  if (!list.display) return null;
  return (
    <Card title="Badges" aside="Earned from results">
      <div className="medals lb-medals">
        {list.badges.map((b) => {
          const mine = b.holders.filter((h) => userIds.has(h.userId));
          const locked = mine.length === 0;
          const icon = ICON[b.key] ?? ICON.top_of_month;
          return (
            <div key={b.key} className={clsx('medal', locked && 'locked')}>
              <div className={clsx('m', icon.tone)} aria-hidden>{locked ? <Lock size={20} /> : icon.icon}</div>
              <b>{b.label}</b>
              <small>{locked ? 'Locked, no one yet' : mine.map((h) => `${h.name}, ${monthLabel(h.period, year)}`).join(' · ')}</small>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
