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
import { rateOn } from '../fxService';

/** Net margin the owner aims for (F-923). */
export const TARGET_NET_MARGIN = 35;

/** Shown on August and September until the owner edits `SystemConfig.periodNotes` (decision D5). */
export const DEFAULT_PERIOD_NOTES: Record<string, string> = {
  '2026-08': 'Booked with the older cost per set. Not restated.',
  '2026-09': 'Booked with the older cost per set. Not restated.',
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface LedgerAccount {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  /** Balance in the account's normal direction (debit accounts: debits less credits). */
  balance: Money.Money;
}

/** Percent with 1 decimal, null when the base is 0. */
export function pct(part: Money.MoneyInput, whole: Money.MoneyInput): number | null {
  if (!Money.isNonZero(whole)) return null;
  return Money.roundHalfUp(Money.mul(Money.div(part, whole), 100), 1).toNumber();
}

/**
 * Every account with its balance over the entries dated in [from, to] (both inclusive instants; no `from` = from the
 * start of the ledger). Voided entries count nothing. Inactive accounts are kept: an old balance on a retired account
 * (1020, 5040) must still sit in the statement or it would not balance.
 */
async function ledger(range: { from?: Date; to: Date }): Promise<LedgerAccount[]> {
  const tenantId = resolveTenantId();
  const [accounts, sums] = await Promise.all([
    prisma.account.findMany({ where: { tenantId }, select: { id: true, code: true, name: true, accountType: true, normalBalance: true } }),
    prisma.accountTransaction.groupBy({
      by: ['accountId'],
      where: {
        tenantId,
        journalEntry: { isVoided: false, entryDate: { ...(range.from ? { gte: range.from } : {}), lte: range.to } },
      },
      _sum: { debitAmount: true, creditAmount: true },
    }),
  ]);
  const byId = new Map(sums.map((s) => [s.accountId, s._sum]));
  return accounts.map((a) => {
    const s = byId.get(a.id);
    const debit = Money.orZero(s?.debitAmount);
    const credit = Money.orZero(s?.creditAmount);
    return {
      code: a.code, name: a.name, type: a.accountType as LedgerAccount['type'],
      balance: a.normalBalance === 'debit' ? Money.sub(debit, credit) : Money.sub(credit, debit),
    };
  });
}

const sumOf = (rows: LedgerAccount[], pick: (a: LedgerAccount) => boolean) =>
  rows.filter(pick).reduce((total, a) => Money.add(total, a.balance), Money.ZERO);
const codeOf = (rows: LedgerAccount[], code: string) => sumOf(rows, (a) => a.code === code);

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

function statementOf(rows: LedgerAccount[], from: string, to: string): IncomeStatement {
  const revenue = sumOf(rows, (a) => a.type === 'revenue');
  const productCost = codeOf(rows, GL_ACCOUNTS.COGS);
  const delivery = codeOf(rows, GL_ACCOUNTS.DELIVERY_FEES);
  const commission = codeOf(rows, GL_ACCOUNTS.SALES_REP_COMMISSION);
  const meta = codeOf(rows, GL_ACCOUNTS.META_AD_SPEND);
  const paystack = codeOf(rows, GL_ACCOUNTS.PAYSTACK_FEES);
  const expenses = sumOf(rows, (a) => a.type === 'expense');
  const named = [productCost, delivery, commission, meta, paystack].reduce((t, v) => Money.add(t, v), Money.ZERO);
  const other = Money.sub(expenses, named);
  const grossProfit = Money.sub(revenue, productCost);
  const net = Money.sub(revenue, expenses);
  return {
    from, to,
    revenue: Money.toApi(revenue),
    productCost: Money.toApi(productCost),
    grossProfit: Money.toApi(grossProfit),
    grossMarginPct: pct(grossProfit, revenue),
    deliveryFees: Money.toApi(delivery),
    repCommission: Money.toApi(commission),
    metaSpend: Money.toApi(meta),
    paystackFees: Money.toApi(paystack),
    otherExpenses: Money.toApi(other),
    totalExpenses: Money.toApi(expenses),
    netProfit: Money.toApi(net),
    netMarginPct: pct(net, revenue),
    hasData: rows.some((a) => Money.isNonZero(a.balance)),
  };
}

/** Income statement for the store days `from` to `to` (YYYY-MM-DD, both included). A range with no entries gives zeros. */
export async function incomeStatement(from: string, to: string): Promise<IncomeStatement> {
  const zone = getStoreTimeZone(getTenantId());
  const start = parseBound(from, 'from', zone);
  const end = new Date(parseBound(to, 'to', zone).getTime() - 1);
  return statementOf(await ledger({ from: start, to: end }), from, to);
}

/** The same statement over [from, to) as instants (what the KPI range helpers return). */
export async function incomeStatementOver(from: Date, to: Date): Promise<IncomeStatement> {
  const zone = getStoreTimeZone(getTenantId());
  const last = new Date(to.getTime() - 1);
  return statementOf(await ledger({ from, to: last }), localDate(from, zone), localDate(last, zone));
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

/** Balance sheet at the end of the store day `asOf` (YYYY-MM-DD; today when left out). A date with no entries gives zeros. */
export async function balanceSheetStatement(asOf?: string): Promise<BalanceSheetStatement> {
  const zone = getStoreTimeZone(getTenantId());
  const day = asOf ?? localDate(new Date(), zone);
  const end = new Date(endOfDay(day, zone).getTime() - 1);
  const rows = await ledger({ to: end });

  const assets = linesOf(rows, 'asset', ASSET_CODES);
  const liabilities = linesOf(rows, 'liability', LIABILITY_CODES);
  const totalAssets = sumOf(rows, (a) => a.type === 'asset');
  const totalLiabilities = sumOf(rows, (a) => a.type === 'liability');
  const ownersEquity = codeOf(rows, GL_ACCOUNTS.OWNER_EQUITY);
  const otherEquity = Money.sub(sumOf(rows, (a) => a.type === 'equity'), ownersEquity);
  const resultToDate = Money.sub(sumOf(rows, (a) => a.type === 'revenue'), sumOf(rows, (a) => a.type === 'expense'));
  const totalEquity = Money.add(Money.add(ownersEquity, otherEquity), resultToDate);
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
      hint: !Money.isNonZero(ownersEquity) ? "No owner's equity (3010) is booked yet." : null,
    },
    totalLiabilitiesAndEquity: Money.toApi(right),
    isBalanced: balanced,
    outOfBalanceBy: balanced ? null : Money.toApi(gap),
  };
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
  const notes: Record<string, string> = { ...DEFAULT_PERIOD_NOTES };
  for (const [key, value] of Object.entries(own)) if (typeof value === 'string') notes[key] = value;
  return notes;
}

/** Naira per GH₵1 over a range, from the stored rate history: one value, several ("mixed rates") or none. */
async function metaRateOver(from: string, to: string): Promise<PlColumn['metaRate']> {
  const tenantId = resolveTenantId();
  const rates = new Set<number>();
  const add = (ghsPerNgn: Money.MoneyInput) => { if (Money.gt(ghsPerNgn, 0)) rates.add(Money.roundHalfUp(Money.div(1, ghsPerNgn), 0).toNumber()); };
  const first = await rateOn(tenantId, 'NGN', 'GHS', from);
  if (first) add(first.rate);
  const dated = await prisma.fxRate.findMany({
    where: {
      tenantId,
      date: { gt: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) },
      OR: [{ fromCurrency: 'NGN', toCurrency: 'GHS' }, { fromCurrency: 'GHS', toCurrency: 'NGN' }],
    },
    select: { fromCurrency: true, rate: true },
  });
  for (const r of dated) add(r.fromCurrency === 'NGN' ? r.rate : Money.div(1, r.rate));
  if (rates.size === 0) return { kind: 'none', ngnPerGhs: null };
  if (rates.size === 1) return { kind: 'single', ngnPerGhs: [...rates][0] };
  return { kind: 'mixed', ngnPerGhs: null };
}

/**
 * Columns, oldest first: the `months` full months before the current one, then (compare = 'to-date') the same days of last
 * month and the current month to date. `asOf` (YYYY-MM-DD) stands for "today" so a page or a test can ask for a past view.
 * A month that ended before the first ledger entry has no column. The note of a month comes from `periodNotes`.
 */
export async function monthlyPl(opts: { months?: number; compare?: 'to-date' | 'none'; asOf?: string } = {}): Promise<MonthlyPl> {
  const zone = getStoreTimeZone(getTenantId());
  const today = opts.asOf ?? localDate(new Date(), zone);
  const { year, month, day } = parseYmd(today);
  const months = Math.min(Math.max(Math.trunc(opts.months ?? 2), 1), 24);
  const compare = opts.compare ?? 'to-date';

  const first = await prisma.journalEntry.aggregate({
    where: { tenantId: resolveTenantId(), isVoided: false },
    _min: { entryDate: true },
  });
  const firstDay = first._min.entryDate ? localDate(first._min.entryDate, zone) : null;
  const notes = await periodNotes();

  type Spec = { key: string; label: string; kind: PlColumnKind; from: string; to: string; note: string | null };
  const specs: Spec[] = [];
  for (let n = months; n >= 1; n--) {
    const m = monthsBefore(year, month, n);
    const key = `${m.year}-${String(m.month).padStart(2, '0')}`;
    const to = ymdOf(m.year, m.month, daysInMonth(m.year, m.month));
    if (firstDay === null || to < firstDay) continue;
    specs.push({ key, label: MONTH_NAMES[m.month - 1], kind: 'month', from: ymdOf(m.year, m.month, 1), to, note: notes[key] ?? null });
  }
  if (compare === 'to-date') {
    const prev = monthsBefore(year, month, 1);
    const prevDay = Math.min(day, daysInMonth(prev.year, prev.month));
    specs.push({
      key: 'same-days-last-month', label: `1-${prevDay} ${MONTH_NAMES[prev.month - 1]}`, kind: 'same_days_last_month',
      from: ymdOf(prev.year, prev.month, 1), to: ymdOf(prev.year, prev.month, prevDay), note: null,
    });
    specs.push({
      key: 'to-date', label: `1-${day} ${MONTH_NAMES[month - 1]}`, kind: 'to_date',
      from: ymdOf(year, month, 1), to: ymdOf(year, month, day), note: null,
    });
  }

  const columns: PlColumn[] = [];
  for (const spec of specs) {
    const s = await incomeStatement(spec.from, spec.to);
    const notSplit = spec.note !== null && !Money.isNonZero(s.repCommission);
    columns.push({
      ...s,
      key: spec.key, label: spec.label, kind: spec.kind, note: spec.note,
      repCommission: notSplit ? null : s.repCommission,
      repCommissionNote: notSplit ? 'not split out' : null,
      metaRate: !Money.isNonZero(s.metaSpend) ? { kind: 'none', ngnPerGhs: null } : await metaRateOver(spec.from, spec.to),
    });
  }
  return { asOf: today, targetNetMargin: TARGET_NET_MARGIN, columns };
}
