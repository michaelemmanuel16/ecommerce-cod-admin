import { Target } from '@prisma/client';
import prisma from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { getCurrency } from '../utils/currency';
import { getStoreTimeZone, localDate, monthRange, parseYmd, ymdOfUtc } from './kpi/dates';
import { deliveredRevenueByDay } from './kpi/revenue';
import { ratePercent } from './kpi/rates';
import { loadYearPlan, paceMarker, periodOfTarget, type PaceBasis } from './kpi/leadership';
import { paceChip } from './kpi/status';
import { incomeStatementOf, type LedgerAccount } from './finance/statementsService';
import { STATUS_LABEL, targetStatus, type TargetStatus } from './targetStatus';

/**
 * M6-T15 (F-1101): what each North Star, quarter and month row of the tree has done so far.
 *  - revenue: delivered revenue by delivery date (the KPI helper the Dashboard uses)
 *  - margin: the net margin of the Finance income statement for the same days (rep commission and delivery fee lines included, R6);
 *    null when the ledger holds nothing for them (the page writes "n/a")
 *  - status: `targetStatus`; pace is straight days for a quarter and a month and the quarter plan for the year (owner decision)
 * A future period has its target only: no revenue, no margin, no status.
 * Revenue and the ledger are each read once for January to the last elapsed month and bucketed by month; a quarter and the year are
 * sums of month buckets, and their margin is worked out again from the summed accounts.
 */

export interface Actuals {
  state: 'past' | 'current' | 'future';
  actual: string | null;
  /** Revenue / target, percent to 1 decimal. */
  percent: number | null;
  marginPct: number | null;
  status: { key: TargetStatus; label: string } | null;
  /** Percent the period should have reached today; null for a future or finished period. */
  pace: number | null;
  paceBasis: PaceBasis | null;
  /** "<N> pts ahead / behind the pace", as the dashboard chip reads it. */
  chip: { points: number; tag: 'ahead' | 'behind' | 'on_pace' } | null;
}

const FUTURE: Actuals = { state: 'future', actual: null, percent: null, marginPct: null, status: null, pace: null, paceBasis: null, chip: null };

interface LedgerRow { month: string; code: string; type: LedgerAccount['type']; normal: 'debit' | 'credit'; debit: Money.MoneyInput; credit: Money.MoneyInput }

/** The ledger of [from, to) by store month and account: one query. */
async function ledgerByMonth(tenantId: string, zone: string, from: Date, to: Date): Promise<Map<string, Map<string, LedgerAccount>>> {
  const rows = await prisma.$queryRaw<LedgerRow[]>`
    SELECT TO_CHAR((je.entry_date AT TIME ZONE 'UTC') AT TIME ZONE ${zone}, 'YYYY-MM') AS month, a.code AS code, a.account_type::text AS type,
           a.normal_balance::text AS normal, SUM(t.debit_amount) AS debit, SUM(t.credit_amount) AS credit
    FROM account_transactions t
    JOIN journal_entries je ON je.id = t.journal_entry_id
    JOIN accounts a ON a.id = t.account_id
    WHERE t.tenant_id = ${tenantId} AND je.is_voided = false AND je.entry_date >= ${from} AND je.entry_date < ${to}
    GROUP BY 1, 2, 3, 4`;
  const byMonth = new Map<string, Map<string, LedgerAccount>>();
  for (const r of rows) {
    const debit = Money.parse(r.debit);
    const credit = Money.parse(r.credit);
    const account: LedgerAccount = {
      id: 0, code: r.code, name: r.code, type: r.type, isActive: true, balance: r.normal === 'debit' ? Money.sub(debit, credit) : Money.sub(credit, debit),
    };
    byMonth.set(r.month, (byMonth.get(r.month) ?? new Map()).set(r.code, account));
  }
  return byMonth;
}

const monthsOf = (t: Target): string[] => {
  const out: string[] = [];
  const end = ymdOfUtc(t.periodEnd).slice(0, 7);
  let [y, m] = [t.periodStart.getUTCFullYear(), t.periodStart.getUTCMonth() + 1];
  for (;;) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key >= end) return out;
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
};

export async function actualsOf(rows: Target[], year: number, marginTarget: number): Promise<{ currency: string; actuals: Map<number, Actuals> }> {
  const tenantId = resolveTenantId();
  const zone = getStoreTimeZone(tenantId);
  const today = localDate(new Date(), zone);
  const day = parseYmd(today);
  const northStar = rows.find((r) => r.scope === 'north_star');
  // The last month that has started in this year: nothing before January, nothing after today's month.
  const last = day.year > year ? 12 : day.year === year ? day.month : 0;

  const [currency, plan, revenueDays, ledger] = await Promise.all([
    getCurrency(),
    loadYearPlan(tenantId, year, northStar?.value ?? null),
    last > 0 ? deliveredRevenueByDay(tenantId, monthRange(year, 1, zone).from, monthRange(year, last, zone).to) : [],
    last > 0 ? ledgerByMonth(tenantId, zone, monthRange(year, 1, zone).from, monthRange(year, last, zone).to) : new Map<string, Map<string, LedgerAccount>>(),
  ]);
  const revenueByMonth = new Map<string, Money.Money>();
  for (const d of revenueDays) revenueByMonth.set(d.date.slice(0, 7), Money.add(revenueByMonth.get(d.date.slice(0, 7)) ?? Money.ZERO, d.revenue));

  const actuals = new Map<number, Actuals>();
  for (const t of rows) {
    const start = ymdOfUtc(t.periodStart);
    const end = ymdOfUtc(t.periodEnd);
    if (start > today) { actuals.set(t.id, FUTURE); continue; }
    const months = monthsOf(t);
    const revenue = Money.sum(months.map((m) => revenueByMonth.get(m) ?? Money.ZERO));
    const accounts = new Map<string, LedgerAccount>();
    for (const m of months) {
      for (const [code, a] of ledger.get(m) ?? []) {
        const seen = accounts.get(code);
        accounts.set(code, seen ? { ...seen, balance: Money.add(seen.balance, a.balance) } : a);
      }
    }
    const statement = incomeStatementOf([...accounts.values()], start, end);
    const target = Money.parse(t.value);
    const percent = target.gt(0) ? ratePercent(revenue.toNumber(), target.toNumber()) : null;
    const over = end < today;
    // The pace is that of today inside the period; a finished period has none.
    const period = periodOfTarget(t) ?? 'year';
    const marker = over ? null : paceMarker(day, period, period === 'year' ? plan : undefined);
    const marginPct = statement.hasData ? statement.netMarginPct : null;
    const key = targetStatus({ percent, pace: marker?.percent ?? 100, margin: marginPct, marginTarget, over });
    actuals.set(t.id, {
      state: over ? 'past' : 'current', actual: Money.toApi(revenue), percent, marginPct,
      status: key ? { key, label: STATUS_LABEL[key] } : null,
      pace: marker?.percent ?? null,
      paceBasis: marker?.paceBasis ?? null,
      chip: percent === null || !marker ? null : paceChip(percent, marker.percent),
    });
  }
  return { currency, actuals };
}

/**
 * The status of a person's or role's month progress (count or rate targets, no margin): the same words and rule as the tree.
 * `month` is 'YYYY-MM'. A month that has not started has none.
 */
export function monthStatus(percent: number | null, month: string, today: string): { key: TargetStatus; label: string } | null {
  if (percent === null || `${month}-01` > today) return null;
  const over = today.slice(0, 7) > month;
  const pace = over ? 100 : paceMarker(parseYmd(today), 'month').percent;
  const key = targetStatus({ percent, pace, margin: null, marginTarget: 0, over });
  return key && { key, label: STATUS_LABEL[key] };
}
