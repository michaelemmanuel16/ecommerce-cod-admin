// The sentences of the cash flow tab, built from the API answer (see profit/copy.ts for the same rule).
import type { CashFlowForecastReport, Scenario } from '../../../services/financeReports.service';
import { parseMoney } from '../../../utils/money';
import { shortDay } from '../../dashboard/format';
import { money } from '../profit/format';

type Report = CashFlowForecastReport;

/** The two switch labels: the pace names the delivery success the orders have today, when the server knows it. */
export function scenarioLabels(s: Report['scenario'] | undefined): Record<Scenario, string> {
  return {
    pace: s?.currentRate != null ? `Today's pace, ${Math.round(s.currentRate)}% delivery success` : "Today's pace",
    target: s ? `If delivery success reaches ${s.targetRate}%` : 'If delivery success reaches the target',
  };
}

export interface Finding { title: string; body: string; tone: 'bad' | 'warn' | 'ok' }

/** What the forecast says about cash: the day it runs out, a tight low point, or the lowest point it stays above. */
export function cashFinding(r: Report): Finding {
  const { summary, scenario } = r;
  const when = scenario.key === 'pace' ? "at today's pace" : `even at ${scenario.targetRate}% delivery success`;
  const low = `The lowest point is ${money(summary.lowest.balance)} on ${shortDay(summary.lowest.date)}.`;
  if (summary.status === 'runs_out' && summary.runsOutOn) {
    return { tone: 'bad', title: `Cash runs out around ${shortDay(summary.runsOutOn)} ${when}`, body: `${low} Expected spending is more than what comes in.` };
  }
  if (summary.status === 'tight') {
    return { tone: 'warn', title: `Cash gets tight around ${shortDay(summary.lowest.date)}`, body: `${low} That is under ${summary.tightDays} days of expected spending.` };
  }
  return { tone: 'ok', title: `Cash stays above ${money(summary.lowest.balance)} ${scenario.key === 'target' ? `at ${scenario.targetRate}% delivery success` : when}`, body: low };
}

/** What the forecast assumes, from the pay days the server used and the payables it will pay on day 1. */
export function assumptions(r: Report): string[] {
  const days = r.payDays.overall;
  const lines = [
    r.payDays.fromHistory
      ? `New deliveries are paid after ${days} ${days === 1 ? 'day' : 'days'} on average, from partner payout history.`
      : `No payout history yet, so new deliveries are paid after ${r.payDays.default} days.`,
    'Cash a partner holds lands on that partner\'s usual pay day. Spending is the average of the last 30 days.',
  ];
  if (parseMoney(r.kpis.supplierPayables) > 0) lines.push(`Supplier payables of ${money(r.kpis.supplierPayables)} go out on the first day.`);
  if (r.scenario.key === 'target' && r.scenario.multiplier !== 1) lines.push(`At the target, new deliveries bring in ${r.scenario.multiplier} times as much as today. Nothing else changes.`);
  return lines;
}
