/**
 * M5-T25 (COD-52, F-922, F-923): income statement, balance sheet and monthly profit and loss, all read from the ledger
 * (journal entries that are not voided, by entry date). Nothing here recomputes a past month from today's cost: August and
 * September equal what was booked (decision D5), and the column carries the note.
 *
 * Money in a result is an API string with 2 decimals. A percentage is a number with 1 decimal, or null when the revenue
 * is 0 (the page shows "n/a"; never NaN).
 */
import prisma from '../../utils/prisma';
import * as Money from '../../utils/money';
import { GL_ACCOUNTS } from '../../config/glAccounts';
import { getTenantId, resolveTenantId } from '../../utils/tenantContext';
import { daysInMonth, getStoreTimeZone, localDate, parseBound, parseYmd, endOfDay } from '../kpi/dates';

/** Net margin the owner aims for (F-923). */
export const TARGET_NET_MARGIN = 35;

/** Shown on August and September until the owner edits `SystemConfig.periodNotes` (decision D5). */
export const DEFAULT_PERIOD_NOTES: Record<string, string> = {
  '2026-08': 'Booked with the older cost per set. Not restated.',
  '2026-09': 'Booked with the older cost per set. Not restated.',
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface LedgerAccount {
  id: number;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  isActive: boolean;
  /** Balance in the account's normal direction (debit accounts: debits less credits). */
  balance: Money.Money;
}

type ChartAccount = Omit<LedgerAccount, 'balance'> & { normalBalance: 'debit' | 'credit' };

/** The chart of accounts of the tenant, inactive accounts included (a retired account can still carry an old balance). */
async function loadChart(): Promise<ChartAccount[]> {
  const accounts = await prisma.account.findMany({
    where: { tenantId: resolveTenantId() },
    select: { id: true, code: true, name: true, accountType: true, normalBalance: true, isActive: true },
  });
  return accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.accountType as LedgerAccount['type'], isActive: a.isActive, normalBalance: a.normalBalance as 'debit' | 'credit' }));
}

/** Balance of every account over the entries dated in [from, to] (both inclusive instants; no `from` = from the start of the ledger). Voided entries count nothing. */
async function ledgerOver(chart: ChartAccount[], range: { from?: Date; to: Date }): Promise<LedgerAccount[]> {
  const sums = await prisma.accountTransaction.groupBy({
    by: ['accountId'],
    where: {
      tenantId: resolveTenantId(),
      journalEntry: { isVoided: false, entryDate: { ...(range.from ? { gte: range.from } : {}), lte: range.to } },
    },
    _sum: { debitAmount: true, creditAmount: true },
  });
  const byId = new Map(sums.map((x) => [x.accountId, x._sum]));
  return chart.map(({ normalBalance, ...a }) => {
    const debit = Money.orZero(byId.get(a.id)?.debitAmount);
    const credit = Money.orZero(byId.get(a.id)?.creditAmount);
    return { ...a, balance: normalBalance === 'debit' ? Money.sub(debit, credit) : Money.sub(credit, debit) };
  });
}

/**
 * The one ledger reader (F-922): every account with its balance over the range. The statements, the monthly P&L and the old
 * profit-loss and balance-sheet responses all read through here, so one request gives one set of numbers.
 */
export async function ledgerAccounts(range: { from?: Date; to: Date }): Promise<LedgerAccount[]> {
  return ledgerOver(await loadChart(), range);
}

const sumOf = (rows: LedgerAccount[], pick: (a: LedgerAccount) => boolean) => Money.sum(rows.filter(pick).map((a) => a.balance));
const codeOf = (rows: LedgerAccount[], ...codes: string[]) => sumOf(rows, (a) => codes.includes(a.code));

export interface IncomeStatement {
  from: string;
  to: string;
  revenue: string;
  productCost: string;
  grossProfit: string;
  grossMarginPct: number | null;
  /** 5070: one line for 3PLs and agents, all outcomes. */
  deliveryFees: string;
  /** 5050: rep commission and rewards. */
  repCommission: string;
  /** 5080 */
  metaSpend: string;
  /** 5060 */
  paystackFees: string;
  /** Every other expense account (5100 and the retired ones). */
  otherExpenses: string;
  totalExpenses: string;
  netProfit: string;
  netMarginPct: number | null;
  /** True when the range holds at least one ledger line. */
  hasData: boolean;
}

/**
 * The income statement of a ledger read. Delivery fees are 5070 plus the retired 5040, which holds the old delivery fee of
 * the months booked before M5 (August and September stay as booked, D5). 5020 and 5030 stay in "other expenses".
 */
export function incomeStatementOf(rows: LedgerAccount[], from: string, to: string): IncomeStatement {
  const revenue = sumOf(rows, (a) => a.type === 'revenue');
  const productCost = codeOf(rows, GL_ACCOUNTS.COGS);
  const delivery = codeOf(rows, GL_ACCOUNTS.DELIVERY_FEES, GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION);
  const commission = codeOf(rows, GL_ACCOUNTS.SALES_REP_COMMISSION);
  const meta = codeOf(rows, GL_ACCOUNTS.META_AD_SPEND);
  const paystack = codeOf(rows, GL_ACCOUNTS.PAYSTACK_FEES);
  const expenses = sumOf(rows, (a) => a.type === 'expense');
  const other = Money.sub(expenses, Money.sum([productCost, delivery, commission, meta, paystack]));
  const grossProfit = Money.sub(revenue, productCost);
  const net = Money.sub(revenue, expenses);
  return {
    from, to,
    revenue: Money.toApi(revenue),
    productCost: Money.toApi(productCost),
    grossProfit: Money.toApi(grossProfit),
    grossMarginPct: Money.percentOrNull(grossProfit, revenue),
    deliveryFees: Money.toApi(delivery),
    repCommission: Money.toApi(commission),
    metaSpend: Money.toApi(meta),
    paystackFees: Money.toApi(paystack),
    otherExpenses: Money.toApi(other),
    totalExpenses: Money.toApi(expenses),
    netProfit: Money.toApi(net),
    netMarginPct: Money.percentOrNull(net, revenue),
    hasData: rows.some((a) => Money.isNonZero(a.balance)),
  };
}

/** Income statement for the store days `from` to `to` (YYYY-MM-DD, both included). A range with no entries gives zeros. */
export async function incomeStatement(from: string, to: string): Promise<IncomeStatement> {
  const zone = getStoreTimeZone(getTenantId());
  const start = parseBound(from, 'from', zone);
  const end = new Date(parseBound(to, 'to', zone).getTime() - 1);
  return incomeStatementOf(await ledgerAccounts({ from: start, to: end }), from, to);
}

/** The same statement over [from, to) as instants (what the KPI range helpers return). */
export async function incomeStatementOver(from: Date, to: Date): Promise<IncomeStatement> {
  const zone = getStoreTimeZone(getTenantId());
  const last = new Date(to.getTime() - 1);
  return incomeStatementOf(await ledgerAccounts({ from, to: last }), localDate(from, zone), localDate(last, zone));
}

export interface StatementLine { code: string | null; name: string; amount: string }

export interface BalanceSheetStatement {
  asOf: string;
  assets: { lines: StatementLine[]; total: string };
  liabilities: { lines: StatementLine[]; total: string };
  equity: {
    /** 3010 */
    ownersEquity: string;
    /** Revenue less expenses over the whole ledger up to the date, shown as "Result to date". */
    resultToDate: string;
    /** Equity accounts other than 3010. */
    otherEquity: string;
    total: string;
    hint: string | null;
  };
  totalLiabilitiesAndEquity: string;
  isBalanced: boolean;
  /** "Out of balance by GH₵N" is built by the page from this; null when balanced. */
  outOfBalanceBy: string | null;
}

/** Lines the balance sheet always shows (F-922), in this order. Other accounts with a balance follow. */
const ASSET_CODES = [GL_ACCOUNTS.CASH_IN_HAND, GL_ACCOUNTS.CASH_IN_TRANSIT, GL_ACCOUNTS.PAYSTACK_RECEIVABLE, GL_ACCOUNTS.INVENTORY];
const LIABILITY_CODES = [GL_ACCOUNTS.COMMISSIONS_PAYABLE, GL_ACCOUNTS.UNAPPLIED_PARTNER_RECEIPTS, GL_ACCOUNTS.SUPPLIER_PAYABLES, GL_ACCOUNTS.REFUND_LIABILITY];

function linesOf(rows: LedgerAccount[], type: LedgerAccount['type'], always: string[]): StatementLine[] {
  const own = rows.filter((a) => a.type === type);
  const fixed = always.map((code) => {
    const a = own.find((x) => x.code === code);
    return { code, name: a?.name ?? code, amount: Money.toApi(a?.balance ?? Money.ZERO) };
  });
  const rest = own
    .filter((a) => !always.includes(a.code) && Money.isNonZero(a.balance))
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((a) => ({ code: a.code, name: a.name, amount: Money.toApi(a.balance) }));
  return [...fixed, ...rest];
}

/** The store day's balance sheet from a ledger read that ends at that day (see balanceSheetStatement). */
export function balanceSheetOf(rows: LedgerAccount[], day: string): BalanceSheetStatement {
  const assets = linesOf(rows, 'asset', ASSET_CODES);
  const liabilities = linesOf(rows, 'liability', LIABILITY_CODES);
  const totalAssets = sumOf(rows, (a) => a.type === 'asset');
  const totalLiabilities = sumOf(rows, (a) => a.type === 'liability');
  const ownersEquity = codeOf(rows, GL_ACCOUNTS.OWNER_EQUITY);
  const otherEquity = Money.sub(sumOf(rows, (a) => a.type === 'equity'), ownersEquity);
  const resultToDate = Money.sub(sumOf(rows, (a) => a.type === 'revenue'), sumOf(rows, (a) => a.type === 'expense'));
  const totalEquity = Money.sum([ownersEquity, otherEquity, resultToDate]);
  const right = Money.add(totalLiabilities, totalEquity);
  const gap = Money.sub(totalAssets, right).abs();
  const balanced = gap.lt('0.01');
  return {
    asOf: day,
    assets: { lines: assets, total: Money.toApi(totalAssets) },
    liabilities: { lines: liabilities, total: Money.toApi(totalLiabilities) },
    equity: {
      ownersEquity: Money.toApi(ownersEquity),
      resultToDate: Money.toApi(resultToDate),
      otherEquity: Money.toApi(otherEquity),
      total: Money.toApi(totalEquity),
      hint: Money.isNonZero(ownersEquity) ? null : "No owner's equity (3010) is booked yet.",
    },
    totalLiabilitiesAndEquity: Money.toApi(right),
    isBalanced: balanced,
    outOfBalanceBy: balanced ? null : Money.toApi(gap),
  };
}

/** Balance sheet at the end of the store day `asOf` (YYYY-MM-DD; today when left out). A date with no entries gives zeros. */
export async function balanceSheetStatement(asOf?: string): Promise<BalanceSheetStatement> {
  const zone = getStoreTimeZone(getTenantId());
  const day = asOf ?? localDate(new Date(), zone);
  const end = new Date(endOfDay(day, zone).getTime() - 1);
  return balanceSheetOf(await ledgerAccounts({ to: end }), day);
}

// ---------------------------------------------------------------------------------------------------------------------
// Monthly profit and loss (F-923)
// ---------------------------------------------------------------------------------------------------------------------

export type PlColumnKind = 'month' | 'same_days_last_month' | 'to_date';

export interface PlColumn extends Omit<IncomeStatement, 'repCommission'> {
  key: string;
  label: string;
  kind: PlColumnKind;
  /** Owner-editable note of the month (SystemConfig.periodNotes), or the default for August and September. */
  note: string | null;
  /** The booked commission, or null when the column was booked before commission had its own line ("not split out"). */
  repCommission: string | null;
  repCommissionNote: string | null;
  /** The rate Meta spend was converted at in this column. */
  metaRate: { kind: 'none' | 'single' | 'mixed'; ngnPerGhs: number | null };
}

export interface MonthlyPl {
  asOf: string;
  targetNetMargin: number;
  columns: PlColumn[];
}

const ymdOf = (year: number, month: number, day: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/** Year and month n months before (year, month). */
function monthsBefore(year: number, month: number, n: number) {
  const index = year * 12 + (month - 1) - n;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

async function periodNotes(): Promise<Record<string, string>> {
  const config = await prisma.systemConfig.findFirst({ where: { tenantId: resolveTenantId() }, select: { periodNotes: true } });
  const stored = config?.periodNotes;
  const own = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  return Object.fromEntries(Object.entries(own).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

/** Store day of the tenant's first 5050 posting, or null when none was ever booked. Before it, commission was not booked on its own line. */
async function firstCommissionDay(zone: string): Promise<string | null> {
  const first = await prisma.journalEntry.findFirst({
    where: { tenantId: resolveTenantId(), isVoided: false, transactions: { some: { account: { code: GL_ACCOUNTS.SALES_REP_COMMISSION } } } },
    orderBy: { entryDate: 'asc' },
    select: { entryDate: true },
  });
  return first ? localDate(first.entryDate, zone) : null;
}

/** Naira per GH₵1 of a stored rate row (rows are stored either way round). */
function ngnPerGhs(row: { fromCurrency: string; rate: Money.Money }): number {
  const perGhs = row.fromCurrency === 'GHS' ? row.rate : Money.div(1, row.rate);
  return Money.roundHalfUp(perGhs, 0).toNumber();
}

/**
 * The rate Meta spend was converted at over [from, to]: the rate in force on `from` (the nearest earlier day, else the
 * nearest later one) and every rate that starts inside the range. One value is "single", several are "mixed rates".
 * `history` is every NGN/GHS rate row up to the end of the whole span, read once; a manual rate wins over the automatic one of its day.
 */
function metaRateOf(history: Array<{ fromCurrency: string; rate: Money.Money; date: string; manual: boolean }>, from: string, to: string): PlColumn['metaRate'] {
  const byDay = new Map<string, (typeof history)[number]>();
  for (const r of history) {
    const held = byDay.get(r.date);
    if (!held || (r.manual && !held.manual)) byDay.set(r.date, r);
  }
  const days = [...byDay.keys()].sort();
  const earlier = days.filter((d) => d <= from).pop();
  const start = earlier ?? days.find((d) => d > from);
  const inRange = days.filter((d) => d > from && d <= to);
  const rates = new Set([...(start ? [start] : []), ...inRange].map((d) => ngnPerGhs(byDay.get(d)!)));
  if (rates.size === 0) return { kind: 'none', ngnPerGhs: null };
  return rates.size === 1 ? { kind: 'single', ngnPerGhs: [...rates][0] } : { kind: 'mixed', ngnPerGhs: null };
}

/**
 * Columns, oldest first: the `months` full months before the current one, then (compare = 'to-date') the same days of last
 * month and the current month to date. `asOf` (YYYY-MM-DD) stands for "today" so a page or a test can ask for a past view.
 * A month that ended before the first ledger entry has no column. A column that ends before the tenant's first 5050 posting
 * shows commission as "not split out" and, for August and September, the default note; the owner's `periodNotes` text wins.
 */
export async function monthlyPl(opts: { months?: number; compare?: 'to-date' | 'none'; asOf?: string } = {}): Promise<MonthlyPl> {
  const zone = getStoreTimeZone(getTenantId());
  const today = opts.asOf ?? localDate(new Date(), zone);
  const { year, month, day } = parseYmd(today);
  const months = Math.min(Math.max(Math.trunc(opts.months ?? 2), 1), 24);
  const compare = opts.compare ?? 'to-date';

  const [first, chart, owner, firstCommission] = await Promise.all([
    prisma.journalEntry.aggregate({ where: { tenantId: resolveTenantId(), isVoided: false }, _min: { entryDate: true } }),
    loadChart(),
    periodNotes(),
    firstCommissionDay(zone),
  ]);
  const firstDay = first._min.entryDate ? localDate(first._min.entryDate, zone) : null;

  type Spec = { key: string; label: string; kind: PlColumnKind; from: string; to: string };
  const specs: Spec[] = [];
  for (let n = months; n >= 1; n--) {
    const m = monthsBefore(year, month, n);
    const to = ymdOf(m.year, m.month, daysInMonth(m.year, m.month));
    if (firstDay === null || to < firstDay) continue;
    specs.push({ key: `${m.year}-${String(m.month).padStart(2, '0')}`, label: MONTH_NAMES[m.month - 1], kind: 'month', from: ymdOf(m.year, m.month, 1), to });
  }
  if (compare === 'to-date') {
    const prev = monthsBefore(year, month, 1);
    const prevDay = Math.min(day, daysInMonth(prev.year, prev.month));
    specs.push({ key: 'same-days-last-month', label: `1-${prevDay} ${MONTH_NAMES[prev.month - 1]}`, kind: 'same_days_last_month', from: ymdOf(prev.year, prev.month, 1), to: ymdOf(prev.year, prev.month, prevDay) });
    specs.push({ key: 'to-date', label: `1-${day} ${MONTH_NAMES[month - 1]}`, kind: 'to_date', from: ymdOf(year, month, 1), to: ymdOf(year, month, day) });
  }

  const statements = await Promise.all(specs.map(async (spec) => ({
    spec,
    s: incomeStatementOf(await ledgerOver(chart, { from: parseBound(spec.from, 'from', zone), to: new Date(parseBound(spec.to, 'to', zone).getTime() - 1) }), spec.from, spec.to),
  })));

  // Rates are read once for the whole span, and only when some column has Meta spend.
  const needsRates = statements.some(({ s }) => Money.isNonZero(s.metaSpend));
  const history = needsRates && specs.length > 0
    ? (await prisma.fxRate.findMany({
      where: {
        tenantId: resolveTenantId(), date: { lte: new Date(`${specs[specs.length - 1].to}T00:00:00.000Z`) },
        OR: [{ fromCurrency: 'NGN', toCurrency: 'GHS' }, { fromCurrency: 'GHS', toCurrency: 'NGN' }],
      },
      select: { fromCurrency: true, rate: true, date: true, source: true },
    })).map((r) => ({ fromCurrency: r.fromCurrency, rate: r.rate, date: r.date.toISOString().slice(0, 10), manual: r.source === 'manual' }))
    : [];

  const columns: PlColumn[] = statements.map(({ spec, s }) => {
    const notSplit = firstCommission !== null && spec.to < firstCommission;
    const note = owner[spec.key] ?? (notSplit ? DEFAULT_PERIOD_NOTES[spec.key] ?? null : null);
    return {
      ...s,
      key: spec.key, label: spec.label, kind: spec.kind, note,
      repCommission: notSplit ? null : s.repCommission,
      repCommissionNote: notSplit ? 'not split out' : null,
      metaRate: Money.isNonZero(s.metaSpend) ? metaRateOf(history, spec.from, spec.to) : { kind: 'none', ngnPerGhs: null },
    };
  });
  return { asOf: today, targetNetMargin: TARGET_NET_MARGIN, columns };
}
