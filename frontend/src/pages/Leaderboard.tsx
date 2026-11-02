import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Select, Skeleton, Tabs } from '../components/ui-v2';
import { useV2Page } from '../components/shell/useV2Page';
import { useAuthStore } from '../stores/authStore';
import { leaderboardService, type BoardRole } from '../services/leaderboard.service';
import { todayYmd } from '../utils/format';
import { BlockError } from './dashboard/blocks/Frame';
import { useBlock } from './financial/profit/useBlock';
import { BadgesCard } from './leaderboard/BadgesCard';
import { Podium } from './leaderboard/Podium';
import { RankingTable } from './leaderboard/RankingTable';
import { RewardsCard } from './leaderboard/RewardsCard';
import { ROLE_TABS, isPeriod, periodOptions, ranksFirst } from './leaderboard/model';

const MANAGER_UP = ['super_admin', 'admin', 'manager'];

/**
 * The Leaderboard (M6-T16, F-1104, F-1105, F-1107, F-1108, F-1109), built from docs/mockups/v2/index.html#board. Call reps and
 * Delivery, ranked inside each role by percent of the person's own target; the period select (Today, This week, this month, this
 * year, the months before) changes the data. Rewards, distance to the next tier and badges show for a month or a year only: the API
 * sends none for a day or a week. The Owner, Admin and Manager see everyone; anyone else sees their own row and rank. The page ranks
 * nothing: every rank, percent and message comes from GET /api/leaderboard. The Upsell tab comes with M7.
 */
export function Leaderboard() {
  useV2Page();
  const [params, setParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const today = todayYmd();
  const periods = useMemo(() => periodOptions(today), [today]);
  const role: BoardRole = params.get('role') === 'delivery' ? 'delivery' : 'call_rep';
  const period = isPeriod(params.get('period'), periods) ? params.get('period')! : 'month';
  const seeAll = !!user && MANAGER_UP.includes(user.role);

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => next.set(k, v));
    setParams(next, { replace: true });
  };

  // Both roles are asked so each tab carries its count; the one on screen decides the rest of the page.
  const callReps = useBlock(`lb|call_rep|${period}`, () => leaderboardService.board('call_rep', period));
  const delivery = useBlock(`lb|delivery|${period}`, () => leaderboardService.board('delivery', period));
  const board = role === 'call_rep' ? callReps : delivery;
  const isMonth = /^\d{4}-\d{2}$/.test(period);
  const withRewards = period === 'month' || period === 'year' || isMonth;
  const badgePeriod = isMonth ? period : period === 'month' ? today.slice(0, 7) : undefined;
  const badges = useBlock(`lb|badges|${period}`, () => leaderboardService.badges(badgePeriod).catch(() => null), withRewards);

  const data = board.data;
  const rows = useMemo(() => ranksFirst(data?.rows ?? []), [data]);
  const label = periods.find((p) => p.value === period)?.label ?? '';
  const count = (b: typeof callReps) => (b.data ? b.data.rows.length : undefined);

  return (
    <section className="lb">
      <div className="head">
        <div>
          <h1>Leaderboard</h1>
          <p>Ranked inside each role by % of the person's own target.</p>
        </div>
        <div className="headtools">
          <Tabs
            label="Role" value={role} className="rolebar"
            items={ROLE_TABS.map((t) => ({ id: t.id, label: t.label, count: count(t.id === 'call_rep' ? callReps : delivery) }))}
            onChange={(id) => set({ role: id })}
          />
          <Select compact label="Period" value={period} onChange={(e) => set({ period: e.target.value })}>
            {periods.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </div>
      </div>

      {board.status === 'failed' && <BlockError name="Leaderboard" onRetry={board.retry} />}
      {board.status === 'loading' && !data && <Skeleton height={320} className="skelcard" />}

      {data && (
        <div className={board.status === 'loading' ? 'lb-body busy' : 'lb-body'}>
          {data.note && <p className="lb-note" role="note">{data.note}</p>}
          {seeAll && <Podium role={role} rows={rows} />}
          <div className="grid lb2">
            <RankingTable role={role} rows={rows} period={label} ownOnly={!seeAll} />
            {(data.rewards || (withRewards && badges.data?.display)) && (
              <div className="grid lb-side">
                <RewardsCard board={data} />
                {withRewards && badges.data && (
                  <BadgesCard list={badges.data} userIds={new Set(rows.map((r) => r.userId))} year={today.slice(0, 4)} />
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
