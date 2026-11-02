import clsx from 'clsx';
import { Skeleton, Tag } from '../../../components/ui-v2';
import { initials } from '../format';
import { kindTag } from '../../leaderboard/model';
import { PageLink } from '../links';
import { PATHS } from '../paths';
import { BlockFrame } from './Frame';
import type { Block, TopPerson, TopThisMonth } from '../types';

/** The role's own number, as the mockup writes it: "55% delivery success", "253 confirmed and delivered". */
function mainNumber(p: TopPerson): string {
  return p.main.unit === 'delivery_success' ? `${p.main.value}% delivery success` : `${p.main.value} confirmed and delivered`;
}

const AVATAR: Record<string, string> = { ai_agent: 'violet', company: 'gold' };
// People take the mockup's avatar colours in turn.
const PEOPLE_AVATARS = ['mint', 'gold', 'pine'] as const;

interface Props {
  top: Block<TopThisMonth> | undefined;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}

/** Top this month (F-208): the top 3 by percent of own role target, from the API. The "Leaderboard" button opens the Leaderboard. */
export function TopThisMonthCard({ top, loading, failed, onRetry }: Props) {
  return (
    <BlockFrame name="Top this month" block={top} loading={loading} failed={failed} onRetry={onRetry} skeleton={<Skeleton height={250} className="skelcard" />}>
      {({ people }) => (
        <div className="card topmonth">
          <div className="ct">
            <h3>Top this month</h3>
            <PageLink to={PATHS.leaderboard} className="mini">Leaderboard</PageLink>
          </div>
          {people.length === 0 ? (
            <p className="emptyrow">No one has a target this month yet. Set targets for your roles to see the top three here.</p>
          ) : (
            <ol className="toplist" aria-label="Top this month">
              {people.map((p, i) => (
                <li key={p.userId} className="who">
                  <div className={clsx('rank', p.rank === 1 && 'first')} aria-label={`Rank ${p.rank}`}>{p.rank}</div>
                  <div className={clsx('a', AVATAR[p.kind] ?? PEOPLE_AVATARS[i % PEOPLE_AVATARS.length])}>{initials(p.name)}</div>
                  <div>
                    {p.name}
                    {kindTag(p.kind) && <Tag tone={p.kind === 'ai_agent' ? 'v' : 'n'}>{kindTag(p.kind)}</Tag>}
                    <small>{p.roleName} · {mainNumber(p)}</small>
                  </div>
                  <Tag tone="ok" className="pctag">{p.percent}% of target</Tag>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </BlockFrame>
  );
}
