/**
 * Order-versus-ledger check (M1-T28, F-905).
 *
 * For each store-zone day in the last 45 days, compares the KPI delivered revenue (deliveredRevenueByDay, the one
 * revenue definition) with the net credits (credit minus debit) on GL 4010 plus 4020, grouped by journal
 * `entryDate` store day. A difference above GH₵0.01 opens one `ledger_gap` Finding for that day
 * (subjectType 'day', subjectId 'YYYY-MM-DD', amount = order revenue minus ledger). A later run updates the
 * amount of the day's open Finding instead of adding another. Findings are never closed or deleted here.
 *
 * Both sides cover the same orders. 4010 holds delivered physical orders (revenue entry at deliveryDate, return
 * reversal at returnedAt). 4020 holds digital sales, posted at Paystack settlement; the KPI counts a paid
 * `digital_delivered` order at its payment time. Voided journal entries are left out of the ledger side.
 *
 * The last run time is kept as an AuditLog row (action `ledger_check_run`), so no table is added.
 */
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { runInTenant } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { GL_ACCOUNTS } from '../config/glAccounts';
import { deliveredRevenueByDay } from './kpi/revenue';
import { getStoreTimeZone, localDate, shiftYmd, startOfDay } from './kpi/dates';

const LEDGER_CHECK_DAYS = 45;
const LEDGER_GAP_TOLERANCE = '0.01';
const LEDGER_CHECK_ACTION = 'ledger_check_run';
const PAYSTACK_UNSETTLED_DAYS = 7;

interface LedgerCheckResult {
  days: number;
  gapDays: string[];
}

/** Net 4010 + 4020 credits per store-zone day of journal entryDate, for [from, to). Voided entries are skipped. */
async function ledgerByDay(tenantId: string, from: Date, to: Date): Promise<Map<string, Money.Money>> {
  const zone = getStoreTimeZone(tenantId);
  const rows = await prisma.$queryRaw<Array<{ day: string; net: string }>>(Prisma.sql`
    SELECT TO_CHAR((j.entry_date AT TIME ZONE 'UTC') AT TIME ZONE ${zone}, 'YYYY-MM-DD') AS day,
           SUM(t.credit_amount - t.debit_amount)::text AS net
    FROM account_transactions t
    JOIN journal_entries j ON j.id = t.journal_entry_id
    JOIN accounts a ON a.id = t.account_id
    WHERE t.tenant_id = ${tenantId} AND j.tenant_id = ${tenantId} AND NOT j.is_voided
      AND a.code IN (${GL_ACCOUNTS.PRODUCT_REVENUE}, ${GL_ACCOUNTS.DIGITAL_REVENUE})
      AND j.entry_date >= ${from} AND j.entry_date < ${to}
    GROUP BY 1`);
  return new Map(rows.map((r) => [r.day, Money.parse(r.net)]));
}

/**
 * Paystack money that has sat too long (F-934). When 1030 holds a balance, has a debit older than 7 days, and no
 * `paystack_payout` entry was posted in the last 7 days, one `paystack_unsettled` Finding opens (amount = the 1030
 * balance). While one is open the next runs only update its amount. Runs inside the tenant context.
 */
async function checkPaystackUnsettled(tenantId: string, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - PAYSTACK_UNSETTLED_DAYS * 24 * 60 * 60 * 1000);
  const account = await prisma.account.findFirst({ where: { code: GL_ACCOUNTS.PAYSTACK_RECEIVABLE }, select: { id: true, currentBalance: true } });
  const balance = Money.orZero(account?.currentBalance);
  const existing = await prisma.finding.findFirst({ where: { type: 'paystack_unsettled', status: 'open' } });

  let unsettled = false;
  if (account && balance.gt(0)) {
    const [oldDebit, recentPayout] = await Promise.all([
      prisma.accountTransaction.findFirst({
        where: { accountId: account.id, debitAmount: { gt: 0 }, journalEntry: { isVoided: false, entryDate: { lt: cutoff } } },
        select: { id: true },
      }),
      prisma.journalEntry.findFirst({
        where: { sourceType: 'paystack_payout', isVoided: false, entryDate: { gte: cutoff } },
        select: { id: true },
      }),
    ]);
    unsettled = !!oldDebit && !recentPayout;
  }

  if (!unsettled) return false;
  if (existing) {
    if (!Money.parse(existing.amount ?? 0).eq(balance)) await prisma.finding.update({ where: { id: existing.id }, data: { amount: balance } });
  } else {
    await prisma.finding.create({
      data: {
        tenantId,
        type: 'paystack_unsettled',
        subjectType: 'account',
        subjectId: GL_ACCOUNTS.PAYSTACK_RECEIVABLE,
        amount: balance,
        note: `Paystack receivable (1030) has had no payout in ${PAYSTACK_UNSETTLED_DAYS} days.`,
      },
    });
  }
  return true;
}

/** Check one tenant. `now` is a parameter so tests can run on a fixed date. */
export async function checkLedgerForTenant(tenantId: string, now: Date = new Date()): Promise<LedgerCheckResult> {
  return runInTenant(tenantId, async () => {
    const zone = getStoreTimeZone(tenantId);
    const today = localDate(now, zone);
    const firstDay = shiftYmd(today, -(LEDGER_CHECK_DAYS - 1));
    const from = startOfDay(firstDay, zone);
    const to = startOfDay(shiftYmd(today, 1), zone);

    const [orderDays, ledger] = await Promise.all([
      deliveredRevenueByDay(tenantId, from, to),
      ledgerByDay(tenantId, from, to),
    ]);
    const orders = new Map(orderDays.map((d) => [d.date, Money.parse(d.revenue)]));

    const gaps = new Map<string, Money.Money>();
    const days = [...new Set([...orders.keys(), ...ledger.keys()])].sort();
    for (const day of days) {
      const gap = Money.sub(orders.get(day) ?? Money.ZERO, ledger.get(day) ?? Money.ZERO);
      if (gap.abs().gt(LEDGER_GAP_TOLERANCE)) gaps.set(day, gap);
    }
    const gapDays = [...gaps.keys()];

    // One open Finding per gap day: add the missing ones, update the amount of the others. Never closed or deleted.
    const open = await prisma.finding.findMany({
      where: { tenantId, type: 'ledger_gap', status: 'open', subjectType: 'day', subjectId: { in: gapDays } },
    });
    const openByDay = new Map(open.map((f) => [f.subjectId, f]));
    const missing = gapDays.filter((day) => !openByDay.has(day));
    await Promise.all([
      missing.length
        ? prisma.finding.createMany({
            data: missing.map((day) => ({ tenantId, type: 'ledger_gap' as const, status: 'open' as const, subjectType: 'day', subjectId: day, amount: gaps.get(day) })),
          })
        : undefined,
      ...[...openByDay.values()]
        .filter((f) => !Money.parse(f.amount ?? 0).eq(gaps.get(f.subjectId) as Money.Money))
        .map((f) => prisma.finding.update({ where: { id: f.id }, data: { amount: gaps.get(f.subjectId) } })),
    ]);

    await checkPaystackUnsettled(tenantId, now);

    await prisma.auditLog.create({
      data: {
        tenantId,
        action: LEDGER_CHECK_ACTION,
        resource: 'ledger_check',
        metadata: { from: firstDay, to: today, gapDays: gapDays.length },
      },
    });
    if (gapDays.length > 0) logger.warn(`Ledger check: tenant ${tenantId} has ${gapDays.length} day(s) with a gap`, { gapDays });
    return { days: days.length, gapDays };
  });
}

interface LedgerHealth {
  lastRunAt: string | null;
  openGaps: Array<{ day: string; amount: string }>;
}

/** Last run time and open `ledger_gap` Findings of the current tenant (tenant context from the request). */
export async function getLedgerHealth(): Promise<LedgerHealth> {
  const [lastRun, findings] = await Promise.all([
    prisma.auditLog.findFirst({ where: { action: LEDGER_CHECK_ACTION }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.finding.findMany({ where: { type: 'ledger_gap', status: 'open', subjectType: 'day' }, orderBy: { subjectId: 'asc' } }),
  ]);
  return {
    lastRunAt: lastRun ? lastRun.createdAt.toISOString() : null,
    openGaps: findings.map((f) => ({ day: f.subjectId, amount: Money.toApi(f.amount ?? 0) })),
  };
}
