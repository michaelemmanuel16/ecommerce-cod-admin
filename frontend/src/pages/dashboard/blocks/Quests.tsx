import { Banknote, CalendarCheck, Check, PhoneCall, ShoppingCart } from 'lucide-react';
import clsx from 'clsx';
import { Tag } from '../../../components/ui-v2';
import { BAR_OF_TONE, INFO, type Info } from '../copy';
import { compactMoney, hundredsMoney, wholePercent } from '../format';
import { PageLink } from '../links';
import { PATHS } from '../paths';
import { parseMoney } from '../../../utils/money';
import type { QuestItem, Quests } from '../types';

const QUEST = {
  new_orders: { title: 'New orders', icon: <ShoppingCart />, info: INFO.newOrders, to: PATHS.orders },
  delivered_revenue: { title: 'Delivered revenue', icon: <Banknote />, info: INFO.deliveredRevenue, to: PATHS.reports },
  failed_delivery_calls: { title: 'Failed delivery calls', icon: <PhoneCall />, info: INFO.failedCalls, to: PATHS.orders },
} satisfies Record<QuestItem['key'], { title: string; icon: JSX.Element; info: Info; to: string | null }>;

function detail(q: QuestItem, currency: string): string {
  if (q.key === 'delivered_revenue') {
    return q.target === null ? `${compactMoney(q.value, currency)} delivered` : `${compactMoney(q.value, currency)} of ${hundredsMoney(q.target, currency)}`;
  }
  if (q.key === 'failed_delivery_calls') return `${parseMoney(q.value)} of ${parseMoney(q.target)} done · daily target, set in Targets`;
  return q.target === null ? `${parseMoney(q.value)} orders · no target` : `${parseMoney(q.value)} of ${parseMoney(q.target)} orders`;
}

/** Today's targets (F-203): the three daily quests. */
export function QuestsRow({ quests, currency }: { quests: Quests; currency: string }) {
  return (
    <div className="quests">
      <div className="card qhead">
        <h3>Today's targets</h3>
        {quests.onTargetDays && (
          <div className="ontarget">
            <CalendarCheck />On target {quests.onTargetDays.hit} of {quests.onTargetDays.of} days this month
          </div>
        )}
      </div>
      {quests.items.map((q) => {
        const meta = QUEST[q.key];
        const done = q.tag === 'hit';
        const tagTone = q.percent === null ? 'n' : q.tone;
        return (
          <div key={q.key} className={clsx('card quest', done && 'done')}>
            <div className="ck">{done ? <Check /> : meta.icon}</div>
            <div className="qbody">
              <b><PageLink to={meta.to} className="plain" tip={meta.info}>{meta.title}</PageLink></b>
              <small>{detail(q, currency)}</small>
              <div className="prog">
                <i className={BAR_OF_TONE[q.tone]} style={{ width: `${Math.min(Math.max(q.percent ?? 0, 0), 100)}%` }} />
              </div>
            </div>
            <Tag tone={done ? 'ok' : tagTone}>{done ? 'Hit' : q.percent === null ? 'No target' : wholePercent(q.percent)}</Tag>
          </div>
        );
      })}
    </div>
  );
}
