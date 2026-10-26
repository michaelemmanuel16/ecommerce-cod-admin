/**
 * Finance health check (F-931, M5-T29). One list of rules; each rule returns a count and a short sample, so the
 * answer is never a bare "ok". The list is `HEALTH_CHECKS`: a new rule is one more entry.
 * Every rule reads the current tenant (tenant context), except `accounts_without_tenant`, which counts rows that
 * have no tenant at all.
 */
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { GLAccountService } from './glAccountService';
import { getLedgerHealth } from './ledgerCheckService';
import { resolveTenantId } from '../utils/tenantContext';
import { addDays } from './kpi/dates';
import { BALANCE_TOLERANCE } from '../config/glAccounts';

export interface HealthCheckResult {
  rule: string;
  label: string;
  ok: boolean;
  count: number;
  /** Up to SAMPLE_SIZE examples of the failure (ids, codes or days). */
  sample: Array<string | number>;
}

const SAMPLE_SIZE = 10;

type Found = { count: number; sample: Array<string | number> };
/** Results shared by several rules, read once per run. */
interface HealthContext {
  balances: ReturnType<typeof GLAccountService.verifyAllAccountBalances>;
  ledger: ReturnType<typeof getLedgerHealth>;
}
interface HealthCheck {
  rule: string;
  label: string;
  run: (ctx: HealthContext) => Promise<Found>;
}

const found = (count: number, sample: Array<string | number>): Found => ({ count, sample: sample.slice(0, SAMPLE_SIZE) });

export const HEALTH_CHECKS: HealthCheck[] = [
  {
    rule: 'unbalanced_entries',
    label: 'Journal entries where debits differ from credits',
    run: async () => {
      const tenantId = resolveTenantId();
      const tolerance = BALANCE_TOLERANCE.toString();
      // One grouped query; the count is a subquery so only SAMPLE_SIZE entry numbers come back.
      const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS n FROM (
          SELECT 1 FROM account_transactions t
          WHERE t.tenant_id = ${tenantId}
          GROUP BY t.journal_entry_id
          HAVING ABS(SUM(t.debit_amount) - SUM(t.credit_amount)) > ${tolerance}::numeric
        ) bad`);
      const sample = await prisma.$queryRaw<Array<{ entry_number: string }>>(Prisma.sql`
        SELECT j.entry_number
        FROM journal_entries j
        JOIN account_transactions t ON t.journal_entry_id = j.id
        WHERE j.tenant_id = ${tenantId}
        GROUP BY j.id, j.entry_number
        HAVING ABS(SUM(t.debit_amount) - SUM(t.credit_amount)) > ${tolerance}::numeric
        ORDER BY j.id
        LIMIT ${SAMPLE_SIZE}`);
      return found(n, sample.map((r) => r.entry_number));
    },
  },
  {
    rule: 'account_balance_mismatch',
    label: 'Accounts whose stored balance differs from the sum of their ledger lines',
    run: async (ctx) => {
      const report = await ctx.balances;
      return found(report.unbalanced.length, report.unbalanced.map((u) => u.code));
    },
  },
  {
    rule: 'expense_without_entry',
    label: 'Manual expenses with no live ledger entry',
    run: async () => {
      const where = { source: 'manual' as const, OR: [{ journalEntryId: null }, { journalEntry: { isVoided: true } }] };
      const [count, rows] = await Promise.all([
        prisma.expense.count({ where }),
        prisma.expense.findMany({ where, select: { id: true }, orderBy: { id: 'asc' }, take: SAMPLE_SIZE }),
      ]);
      return found(count, rows.map((r) => r.id));
    },
  },
  {
    rule: 'delivered_without_delivery_date',
    label: 'Delivered orders with no delivery date',
    run: async () => {
      const where = { status: 'delivered' as const, deliveryDate: null, deletedAt: null };
      const [count, rows] = await Promise.all([
        prisma.order.count({ where }),
        prisma.order.findMany({ where, select: { id: true }, orderBy: { id: 'asc' }, take: SAMPLE_SIZE }),
      ]);
      return found(count, rows.map((r) => r.id));
    },
  },
  {
    rule: 'accounts_without_tenant',
    label: 'Accounts with no tenant (counted across the whole database)',
    run: async () => {
      const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`SELECT COUNT(*)::int AS n FROM accounts WHERE tenant_id IS NULL`);
      return found(n, []);
    },
  },
  {
    rule: 'open_ledger_gap_days',
    label: 'Days where delivered revenue and the ledger differ (open ledger_gap Findings)',
    run: async (ctx) => {
      const { openGaps } = await ctx.ledger;
      return found(openGaps.length, openGaps.map((g) => g.day));
    },
  },
];

export interface FinanceHealthReport {
  ranAt: string;
  healthy: boolean;
  /** Every rule with its count. */
  checks: HealthCheckResult[];
  /** The rules that failed, the same objects as in `checks`. Empty when healthy. */
  failures: HealthCheckResult[];
  balanceIntegrity: {
    totalAccounts: number;
    unbalancedCount: number;
    maxDifference: string;
    isHealthy: boolean;
    unbalanced: Array<{ accountId: number; code: string; difference: string }>;
  };
  journalActivity: { last24Hours: number };
  ledgerCheck: Awaited<ReturnType<typeof getLedgerHealth>>;
}

/** Run every rule for the current tenant. A rule that throws is reported as a failure with count -1, never hidden. */
export async function runFinanceHealth(): Promise<FinanceHealthReport> {
  const ctx: HealthContext = { balances: GLAccountService.verifyAllAccountBalances(), ledger: getLedgerHealth() };
  const [balanceReport, journalCount, ledgerCheck, checks] = await Promise.all([
    ctx.balances,
    prisma.journalEntry.count({ where: { createdAt: { gte: addDays(new Date(), -1) } } }),
    ctx.ledger,
    Promise.all(HEALTH_CHECKS.map(async (c): Promise<HealthCheckResult> => {
      try {
        const { count, sample } = await c.run(ctx);
        return { rule: c.rule, label: c.label, ok: count === 0, count, sample };
      } catch {
        return { rule: c.rule, label: `${c.label} (the check itself failed to run)`, ok: false, count: -1, sample: [] };
      }
    })),
  ]);
  const failures = checks.filter((c) => !c.ok);
  return {
    ranAt: new Date().toISOString(),
    healthy: failures.length === 0,
    checks,
    failures,
    balanceIntegrity: {
      totalAccounts: balanceReport.totalAccounts,
      unbalancedCount: balanceReport.unbalanced.length,
      maxDifference: balanceReport.maxDifference.toFixed(4),
      isHealthy: balanceReport.unbalanced.length === 0,
      unbalanced: balanceReport.unbalanced.map((u) => ({ accountId: u.accountId, code: u.code, difference: u.difference.toFixed(4) })),
    },
    journalActivity: { last24Hours: journalCount },
    ledgerCheck,
  };
}
