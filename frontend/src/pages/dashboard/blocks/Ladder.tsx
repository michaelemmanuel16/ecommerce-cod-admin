import { TrendingUp } from 'lucide-react';
import { Tag } from '../../../components/ui-v2';
import { BAR_OF_PROGRESS, INFO, PROGRESS_TAG } from '../copy';
import { compactMoney, hundredsMoney, monthName, plural, quarterOf, wholeMoney, wholePercent, parseDay } from '../format';
import { PageLink } from '../links';
import { PATHS } from '../paths';
import { InfoTip } from './Frame';
import type { Ladder, ProgressTag, Rung } from '../types';

/** The ring on the North Star card: a circle of r=38, so the full dash is 2 x pi x 38. Drawing only. */
const RING = 238.8;

const clampWidth = (percent: number | null) => `${Math.min(Math.max(percent ?? 0, 0), 100)}%`;

function Bar({ percent, tag, pace }: { percent: number | null; tag: ProgressTag; pace?: number }) {
  return (
    <div className="prog">
      <i className={BAR_OF_PROGRESS[tag]} style={{ width: clampWidth(percent) }} />
      {pace !== undefined && <span className="pace" style={{ left: `${pace}%` }} />}
    </div>
  );
}

function RungView({ label, info, rung, currency }: { label: string; info: typeof INFO.quarter; rung: Rung; currency: string }) {
  const tag = PROGRESS_TAG[rung.tag];
  return (
    <div className="rung">
      <small>
        <PageLink to={PATHS.targets} className="plain">{label}</PageLink>
        <InfoTip info={info} />
      </small>
      <div className="v num">{compactMoney(rung.actual, currency)} <Tag tone={tag.tone}>{tag.label}</Tag></div>
      <div className="t">
        {rung.target === null ? 'No target set' : `of ${wholeMoney(rung.target, currency)} · ${plural(rung.daysLeft, 'day')} left`}
      </div>
      <Bar percent={rung.percent} tag={rung.tag} pace={rung.target === null ? undefined : rung.pace} />
    </div>
  );
}

/** Target ladder (F-202): year on the pine card, then quarter, month and today. Every figure, pace and tag is from the API. */
export function LadderCard({ ladder, asOfDate }: { ladder: Ladder; asOfDate: string | null }) {
  const { year, quarter, month, day, currency } = ladder;
  const y = asOfDate ? parseDay(asOfDate).year : null;
  const chip = year.paceChip;
  const dayTag = day.tag === 'hit' ? PROGRESS_TAG.hit : day.tag === 'in_progress' ? { label: 'In progress', tone: 'n' as const } : PROGRESS_TAG.no_target;
  const dayBar: ProgressTag = day.tag === 'hit' ? 'hit' : day.tag === 'in_progress' ? 'behind' : 'no_target';
  return (
    <div className="card ladder">
      <div className="ns">
        <small>North Star{y ? ` ${y}` : ''} {'·'} delivered revenue <InfoTip info={INFO.northStar} /></small>
        <div className="big num">{compactMoney(year.actual, currency)}</div>
        <div className="of">{year.target === null ? 'No North Star target set yet' : `of ${wholeMoney(year.target, currency)} this year`}</div>
        {year.percent !== null && (
          <svg className="nsring" width="92" height="92" viewBox="0 0 92 92" aria-hidden="true">
            <circle cx="46" cy="46" r="38" fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="9" />
            <circle
              cx="46" cy="46" r="38" fill="none" stroke="var(--white)" strokeWidth="9" strokeLinecap="round"
              strokeDasharray={RING} strokeDashoffset={RING * (1 - Math.min(year.percent, 100) / 100)} transform="rotate(-90 46 46)"
            />
            <text x="46" y="52" textAnchor="middle" fill="currentColor" fontFamily="Bricolage Grotesque" fontWeight="800" fontSize="19">{wholePercent(year.percent)}</text>
          </svg>
        )}
        {chip && (
          <div className="chip">
            <TrendingUp style={{ width: 14, height: 14 }} />
            {chip.tag === 'on_pace' ? "On the year's pace" : `${plural(chip.points, 'pt')} ${chip.tag === 'behind' ? 'behind' : 'ahead of'} the year's pace`}
          </div>
        )}
        {/* The margin chip (F-202) comes with the margin KPI in M5: the API sends no margin yet, so the chip is left out. */}
      </div>
      <div className="rungs">
        <RungView label={asOfDate ? `Q${quarterOf(asOfDate)} target` : 'Quarter target'} info={INFO.quarter} rung={quarter} currency={currency} />
        <RungView label={asOfDate ? `${monthName(asOfDate)} target` : 'Month target'} info={INFO.month} rung={month} currency={currency} />
        <div className="rung">
          <small>Today's target <InfoTip info={INFO.today} /></small>
          <div className="v num">{compactMoney(day.actual, currency)} <Tag tone={dayTag.tone}>{dayTag.label}</Tag></div>
          <div className="t">
            {day.target === null ? 'No target set' : `of ${hundredsMoney(day.target, currency)}`} {'\u00B7'} {day.deliveredOrders} delivered so far
          </div>
          <Bar percent={day.percent} tag={dayBar} />
        </div>
      </div>
    </div>
  );
}
