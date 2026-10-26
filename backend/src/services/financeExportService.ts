/**
 * The four Finance exports (F-930, M5-T29): Profit and loss, Agent aging, General ledger, Cash-flow forecast.
 * Each report is a list of columns and a stream of row batches, written by `streamExport` as CSV or Excel.
 * Money is written with 2 decimals, a dot and no thousand separator (`Money.toApi`). A range with no rows gives a
 * file with the header row only. The general ledger can be large: over `ledgerJobLines()` lines it runs as a background job.
 */
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Requester } from '../utils/authUtils';
import { getTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { ExportColumn, exportMoney } from './exportStream';
import { getStoreTimeZone, localDate, parseInclusiveBound } from './kpi/dates';
import financialService from './financialService';
import agingService from './agingService';

export const FINANCE_REPORTS = ['profit-loss', 'agent-aging', 'general-ledger', 'cash-flow'] as const;
export type FinanceReport = (typeof FINANCE_REPORTS)[number];

/** File name stem of each report. */
const REPORT_FILE_STEM: Record<FinanceReport, string> = {
  'profit-loss': 'profit-and-loss',
  'agent-aging': 'agent-aging',
  'general-ledger': 'general-ledger',
  'cash-flow': 'cash-flow-forecast',
};

export interface ExportRange {
  startDate?: string;
  endDate?: string;
}

export interface ExportInput extends ExportRange {
  /** General ledger only: one account. */
  accountId?: number;
}

export interface ReportExport<T> {
  columns: ExportColumn<T>[];
  batches: AsyncIterable<T[]>;
}

/** Ledger lines above which an export runs as a background job (decision: 50,000). The env value is for tests. */
export const ledgerJobLines = (): number => Number(process.env.LEDGER_EXPORT_JOB_LINES) || 50_000;
const LEDGER_BATCH = 2000;

export function readReport(value: unknown): FinanceReport {
  if (typeof value === 'string' && (FINANCE_REPORTS as readonly string[]).includes(value)) return value as FinanceReport;
  throw new AppError(`report must be one of: ${FINANCE_REPORTS.join(', ')}`, 400, 'INVALID_REPORT');
}

/** File name without extension. It carries the range, or today's date for a report that is a snapshot. */
export function exportFileName(report: FinanceReport, range: ExportRange): string {
  const today = localDate(new Date(), getStoreTimeZone(getTenantId()));
  const from = range.startDate ?? (report === 'general-ledger' ? 'start' : today);
  const to = range.endDate ?? today;
  return `${REPORT_FILE_STEM[report]}_${from.slice(0, 10)}_to_${to.slice(0, 10)}`;
}

async function* once<T>(rows: T[]): AsyncGenerator<T[]> {
  if (rows.length > 0) yield rows;
}

// ── Profit and loss ────────────────────────────────────────────────────────────

interface PlRow { section: string; code: string; name: string; amount: Money.Money }

const plReport = async (range: ExportRange): Promise<ReportExport<PlRow>> => {
  if (!range.startDate || !range.endDate) throw new AppError('Start date and end date are required', 400);
  const pl = await financialService.getProfitLoss(range.startDate, range.endDate);
  const lines = (section: string, accounts: Array<{ code: string; name: string; balance: Money.Money }>): PlRow[] =>
    accounts.filter((a) => !a.balance.isZero()).map((a) => ({ section, code: a.code, name: a.name, amount: a.balance }));
  const accountRows = [...lines('Revenue', pl.revenue.accounts), ...lines('Cost of goods sold', pl.cogs.accounts), ...lines('Expenses', pl.expenses.accounts)];
  // No activity in the range: header row only
  const rows: PlRow[] = accountRows.length === 0 ? [] : [
    ...accountRows,
    { section: 'Totals', code: '', name: 'Gross profit', amount: pl.grossProfit },
    { section: 'Totals', code: '', name: 'Net profit', amount: pl.netIncome },
  ];
  return {
    columns: [
      { header: 'Section', value: (r) => r.section },
      { header: 'Code', value: (r) => r.code },
      { header: 'Account', value: (r) => r.name },
      { header: 'Amount', value: (r) => exportMoney(r.amount), kind: 'money' },
    ],
    batches: once(rows),
  };
};

// ── Agent aging ────────────────────────────────────────────────────────────────

interface AgingRow { agent: string; total: Money.MoneyInput; b01: Money.MoneyInput; b23: Money.MoneyInput; b47: Money.MoneyInput; b8: Money.MoneyInput; oldest: Date | null }

const agingReport = async (): Promise<ReportExport<AgingRow>> => {
  const { buckets } = await agingService.getAgingReport();
  const rows: AgingRow[] = buckets.map((b: any) => ({
    agent: `${b.agent.firstName} ${b.agent.lastName}`,
    total: b.totalBalance, b01: b.bucket_0_1, b23: b.bucket_2_3, b47: b.bucket_4_7, b8: b.bucket_8_plus,
    oldest: b.oldestCollectionDate ? new Date(b.oldestCollectionDate) : null,
  }));
  const zone = getStoreTimeZone(getTenantId());
  return {
    columns: [
      { header: 'Agent', value: (r) => r.agent },
      { header: 'Total balance', value: (r) => exportMoney(r.total), kind: 'money' },
      { header: '0-1 days', value: (r) => exportMoney(r.b01), kind: 'money' },
      { header: '2-3 days', value: (r) => exportMoney(r.b23), kind: 'money' },
      { header: '4-7 days', value: (r) => exportMoney(r.b47), kind: 'money' },
      { header: '8+ days', value: (r) => exportMoney(r.b8), kind: 'money' },
      { header: 'Oldest collection', value: (r) => (r.oldest ? localDate(r.oldest, zone) : '') },
    ],
    batches: once(rows),
  };
};

// ── Cash-flow forecast ─────────────────────────────────────────────────────────

interface ForecastRow { date: string; collection: Money.MoneyInput; expense: Money.MoneyInput; balance: Money.MoneyInput }

const cashFlowReport = async (range: ExportRange, requester?: Requester): Promise<ReportExport<ForecastRow>> => {
  const { forecast } = await financialService.getCashFlowReport(requester);
  const from = range.startDate?.slice(0, 10);
  const to = range.endDate?.slice(0, 10);
  const rows: ForecastRow[] = forecast
    .filter((f) => (!from || f.date >= from) && (!to || f.date <= to))
    .map((f) => ({ date: f.date, collection: f.expectedCollection, expense: f.expectedExpense, balance: f.projectedBalance }));
  return {
    columns: [
      { header: 'Date', value: (r) => r.date },
      { header: 'Expected collection', value: (r) => exportMoney(r.collection), kind: 'money' },
      { header: 'Expected expense', value: (r) => exportMoney(r.expense), kind: 'money' },
      { header: 'Projected balance', value: (r) => exportMoney(r.balance), kind: 'money' },
    ],
    batches: once(rows),
  };
};

// ── General ledger ─────────────────────────────────────────────────────────────

type LedgerLine = Prisma.AccountTransactionGetPayload<{ include: { account: { select: { code: true; name: true } }; journalEntry: { select: { entryNumber: true; entryDate: true; description: true; sourceType: true; isVoided: true } } } }>;

export function ledgerWhere(input: ExportInput): Prisma.AccountTransactionWhereInput {
  const where: Prisma.AccountTransactionWhereInput = {};
  if (input.accountId) where.accountId = input.accountId;
  if (input.startDate || input.endDate) {
    const zone = getStoreTimeZone(getTenantId());
    where.journalEntry = {
      entryDate: {
        ...(input.startDate && { gte: parseInclusiveBound(input.startDate, 'from', zone) }),
        ...(input.endDate && { lte: parseInclusiveBound(input.endDate, 'to', zone, { snapToDay: true }) }),
      },
    };
  }
  return where;
}

export const countLedgerLines = (input: ExportInput): Promise<number> => prisma.accountTransaction.count({ where: ledgerWhere(input) });

/** True when the ledger has more lines than the job limit. One probe row, not a count of every line. */
export async function ledgerOverLimit(input: ExportInput): Promise<boolean> {
  const probe = await prisma.accountTransaction.findMany({ where: ledgerWhere(input), select: { id: true }, orderBy: { id: 'asc' }, skip: ledgerJobLines(), take: 1 });
  return probe.length > 0;
}

/** Ledger lines by (entry date, id), in batches that continue after the last line seen (keyset paging), so memory stays flat. */
async function* ledgerBatches(input: ExportInput): AsyncGenerator<LedgerLine[]> {
  const base = ledgerWhere(input);
  let last: { date: Date; id: number } | undefined;
  for (;;) {
    const after: Prisma.AccountTransactionWhereInput[] = last
      ? [{ OR: [{ journalEntry: { entryDate: { gt: last.date } } }, { journalEntry: { entryDate: last.date }, id: { gt: last.id } }] }]
      : [];
    const batch: LedgerLine[] = await prisma.accountTransaction.findMany({
      where: { AND: [base, ...after] },
      take: LEDGER_BATCH,
      orderBy: [{ journalEntry: { entryDate: 'asc' } }, { id: 'asc' }],
      include: {
        account: { select: { code: true, name: true } },
        journalEntry: { select: { entryNumber: true, entryDate: true, description: true, sourceType: true, isVoided: true } },
      },
    });
    if (batch.length === 0) return;
    yield batch;
    if (batch.length < LEDGER_BATCH) return;
    const tail = batch[batch.length - 1];
    last = { date: tail.journalEntry.entryDate, id: tail.id };
  }
}

type LedgerExportLine = LedgerLine & { balance?: Money.Money };

/**
 * For one account the file also has a Balance column. The lines stream oldest first, so the balance is carried from the
 * balance before the first line (every earlier line summed) and adds up line by line.
 */
async function* withBalance(input: ExportInput, batches: AsyncGenerator<LedgerLine[]>): AsyncGenerator<LedgerExportLine[]> {
  const account = await prisma.account.findUnique({ where: { id: input.accountId! }, select: { normalBalance: true } });
  const sign = (d: Money.MoneyInput, c: Money.MoneyInput) => (account?.normalBalance === 'credit' ? Money.sub(c, d) : Money.sub(d, c));
  const start = input.startDate ? parseInclusiveBound(input.startDate, 'from', getStoreTimeZone(getTenantId())) : undefined;
  const before = start
    ? await prisma.accountTransaction.aggregate({ where: { accountId: input.accountId, journalEntry: { entryDate: { lt: start } } }, _sum: { debitAmount: true, creditAmount: true } })
    : null;
  let balance = sign(Money.orZero(before?._sum?.debitAmount), Money.orZero(before?._sum?.creditAmount));
  for await (const batch of batches) {
    yield batch.map((line) => {
      balance = Money.add(balance, sign(line.debitAmount, line.creditAmount));
      return { ...line, balance };
    });
  }
}

const ledgerReport = (input: ExportInput): ReportExport<LedgerExportLine> => {
  const zone = getStoreTimeZone(getTenantId());
  const columns: ExportColumn<LedgerExportLine>[] = [
    { header: 'Date', value: (l) => localDate(l.journalEntry.entryDate, zone) },
    { header: 'Entry', value: (l) => l.journalEntry.entryNumber },
    { header: 'Account code', value: (l) => l.account.code },
    { header: 'Account', value: (l) => l.account.name },
    { header: 'Description', value: (l) => l.description || l.journalEntry.description },
    { header: 'Source', value: (l) => l.journalEntry.sourceType },
    { header: 'Debit', value: (l) => exportMoney(l.debitAmount), kind: 'money' },
    { header: 'Credit', value: (l) => exportMoney(l.creditAmount), kind: 'money' },
    { header: 'Voided', value: (l) => (l.journalEntry.isVoided ? 'yes' : 'no') },
  ];
  if (input.accountId) columns.push({ header: 'Balance', value: (l) => exportMoney(l.balance), kind: 'money' });
  return { columns, batches: input.accountId ? withBalance(input, ledgerBatches(input)) : ledgerBatches(input) };
};

/** The columns and row stream of one report. Throws a 400 for a bad range before anything is written. */
export async function buildReport(report: FinanceReport, input: ExportInput, requester?: Requester): Promise<ReportExport<any>> {
  switch (report) {
    case 'profit-loss': return plReport(input);
    case 'agent-aging': return agingReport();
    case 'cash-flow': return cashFlowReport(input, requester);
    case 'general-ledger': return ledgerReport(input);
  }
}
