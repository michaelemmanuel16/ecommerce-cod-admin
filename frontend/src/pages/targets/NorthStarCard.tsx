import { useNavigate } from 'react-router-dom';
import { Card, EmptyState, Tag } from '../../components/ui-v2';
import { useFinancialStore } from '../../stores/financialStore';
import type { Tree, TreeNode } from '../../services/targets.service';
import {
  STATUS_TONE, marginText, marginTone, monthClass, monthName, northStarTag, northStarTitle, progressLine, shortMonth,
} from './model';
import { compactMoney } from '../dashboard/format';

/** The North Star card and its quarter tree with a month row each (F-1101). A future month shows its target only. */
export function NorthStarCard({ tree }: { tree: Tree }) {
  const navigate = useNavigate();
  const setDateRange = useFinancialStore((s) => s.setDateRange);
  const currency = tree.currency ?? 'GHS';
  const ns = tree.northStar;

  if (!ns) {
    return (
      <Card title="North Star">
        <EmptyState title="No North Star yet" text="The Owner sets the yearly revenue target in setup. Quarters and months follow from it." />
      </Card>
    );
  }
  const tag = northStarTag(ns, tree.marginTarget);
  const monthsOf = (q: TreeNode) => tree.months.filter((m) => m.periodStart >= q.periodStart && m.periodStart <= q.periodEnd);
  // A month click opens Finance for that month: the Finance date control is the page's own range
  const openFinance = (m: TreeNode) => {
    setDateRange(m.periodStart, m.periodEnd);
    navigate('/finance');
  };

  return (
    <Card
      title={northStarTitle(ns, tree.marginTarget, currency)}
      aside={tag && <Tag tone={tag.tone}>{tag.text}</Tag>}
    >
      <div className="tg-tree">
        {tree.quarters.map((q, i) => {
          const a = q.actuals;
          return (
            <div key={q.id} className={`tg-q${a?.state === 'current' ? ' now' : ''}`}>
              <h4>
                Q{i + 1}
                {a?.status && <Tag tone={STATUS_TONE[a.status.key]}>{a.status.label}</Tag>}
              </h4>
              <div className="tg-line">{progressLine(q, currency)}</div>
              {a && a.state !== 'future' && (
                <Tag tone={marginTone(a.marginPct, tree.marginTarget)}>Margin {marginText(a.marginPct, tree.marginTarget)}</Tag>
              )}
              <div className="tg-months">
                {monthsOf(q).map((m) => {
                  const ma = m.actuals;
                  const future = !ma || ma.state === 'future';
                  const ym = m.periodStart.slice(0, 7);
                  const shown = future || ma.actual === null ? m.value : ma.actual;
                  return (
                    <button
                      key={m.id} type="button" className={`tg-month ${monthClass(ma)}${future ? ' future' : ''}`}
                      aria-label={future ? `${monthName(ym)} target ${compactMoney(m.value, currency)}, open Finance` : `${monthName(ym)} ${compactMoney(shown, currency)} delivered, open Finance`}
                      onClick={() => openFinance(m)}
                    >
                      {shortMonth(ym)}
                      <b>{compactMoney(shown, currency).replace(/^\D+/, '')}</b>
                      {!future && ma.marginPct !== null && <em>{Math.round(ma.marginPct)}%</em>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
