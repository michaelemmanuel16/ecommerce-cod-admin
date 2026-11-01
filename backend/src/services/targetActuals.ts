import { Target } from '@prisma/client';
import { resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { getCurrency } from '../utils/currency';
import { getStoreTimeZone, localDate, monthRange, parseYmd, ymdOfUtc } from './kpi/dates';
import { deliveredRevenue } from './kpi/revenue';
import { ratePercent } from './kpi/rates';
import { loadYearPlan, paceMarker, type PaceBasis } from './kpi/leadership';
import { paceChip } from './kpi/status';
import { incomeStatementOver } from './finance/statementsService';
import { STATUS_LABEL, targetStatus, type TargetStatus } from './targetStatus';

/**
 * M6-T15 (F-1101): what each North Star, quarter and month row of the tree has done so far.
 *  - revenue: delivered revenue by delivery date (the KPI helper the Dashboard uses)
 *  - margin: the net margin of the Finance income statement for the same days (rep commission and delivery fee lines included, R6);
 *    null when the ledger holds nothing for them (the page writes "n/a")
 *  - status: `targetStatus`; pace is straight days for a quarter and a month and the quarter plan for the year (owner decision)
 * A future period has its target only: no revenue, no margin, no status.
 */

export interface Actuals {
  state: 'past' | 'current' | 'future';
  actual: string | null;
  /** Revenue / target, percent to 1 decimal. */
  percent: number | null;
  marginPct: number | null;
  status: { key: TargetStatus; label: string } | null;
  /** Percent the period should have reached today; null for a future period. */
  pace: number | null;
  paceBasis: PaceBasis | null;
  /** "<N> pts ahead / behind the pace", as the dashboard chip reads it. */
  chip: { points: number; tag: 'ahead' | 'behind' | 'on_pace' } | null;
}

const FUTURE: Actuals = { state: 'future', actual: null, percent: null, marginPct: null, status: null, pace: null, paceBasis: null, chip: null };

const period = (t: Target): 'month' | 'quarter' | 'year' => (t.scope === 'month' ? 'month' : t.scope === 'quarter' ? 'quarter' : 'year');

export async function actualsOf(rows: Target[], year: number, marginTarget: number): Promise<{ currency: string; actuals: Map<number, Actuals> }> {
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(tenantId);
  const today = localDate(new Date(), zone);
  const day = parseYmd(today);
  const northStar = rows.find((r) => r.scope === 'north_star');
  const plan = await loadYearPlan(tenantId, year, northStar?.value ?? null);

  const one = async (t: Target): Promise<[number, Actuals]> => {
    const start = ymdOfUtc(t.periodStart);
    const end = ymdOfUtc(t.periodEnd);
    if (start > today) return [t.id, FUTURE];
    const startParts = parseYmd(start);
    const endParts = parseYmd(end);
    const from = monthRange(startParts.year, startParts.month, zone).from;
    const to = monthRange(endParts.year, endParts.month, zone).to;
    const [revenue, statement] = await Promise.all([deliveredRevenue(tenantId, from, to), incomeStatementOver(from, to)]);
    const actual = revenue.total.value;
    const target = Money.parse(t.value);
    const percent = target.gt(0) ? ratePercent(Money.parse(actual).toNumber(), target.toNumber()) : null;
    const over = end < today;
    // The pace is that of today inside the period; a finished period has none.
    const marker = over ? null : paceMarker(day, period(t), period(t) === 'year' ? plan : undefined);
    const marginPct = statement.hasData ? statement.netMarginPct : null;
    const key = targetStatus({ percent, pace: marker?.percent ?? 100, margin: marginPct, marginTarget, over });
    return [t.id, {
      state: over ? 'past' : 'current', actual, percent, marginPct,
      status: key ? { key, label: STATUS_LABEL[key] } : null,
      pace: marker?.percent ?? null,
      paceBasis: marker?.paceBasis ?? null,
      chip: percent === null || !marker ? null : paceChip(percent, marker.percent),
    }];
  };

  const [currency, entries] = await Promise.all([getCurrency(), Promise.all(rows.map(one))]);
  return { currency, actuals: new Map(entries) };
}
