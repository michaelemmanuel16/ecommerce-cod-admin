/**
 * Meta spend to the ledger (M8-T07, COD-72).
 *
 * One Expense per (ad account, day): `source=meta`, in the store currency, with the original amount and the FX
 * rate kept on the row. The first post is DR 5080 / CR 1010. A later pull that changes the day posts only the
 * difference as a new entry; posted entries are never edited or deleted. A day with no FX rate posts nothing and
 * opens one `fx_missing` Finding; the next run with a rate posts the day and closes the Finding.
 * Call inside the tenant context. T06 calls it after each pull.
 */
import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';
import * as Money from '../../utils/money';
import { getCurrency } from '../../utils/currency';
import { resolveTenantId } from '../../utils/tenantContext';
import { TRANSACTION_CONFIG } from '../../config/transactionConfig';
import { GLAutomationService } from '../glAutomationService';
import { getSystemUserId } from '../systemUserService';
import { rateOn } from '../fxService';
import { utcDateOfYmd } from '../kpi/dates';

export interface MetaLedgerResult {
  posted: number;
  adjusted: number;
  unchanged: number;
  waitingForRate: number;
}

const FINDING_SUBJECT = 'meta_ad_day';

/** Category of Meta spend rows. The list has no Meta entry (the spend sits in 5080), so they use Marketing. */
const META_EXPENSE_CATEGORY = 'Marketing';

/** The converted amount of a day, rounded to 2 dp. */
export function convertSpend(original: Money.MoneyInput, rate: Money.MoneyInput): Money.Money {
  return Money.roundHalfUp(Money.mul(original, rate), 2);
}

export async function postMetaSpend(adAccountId: number, dates: string[]): Promise<MetaLedgerResult> {
  const tenantId = resolveTenantId();
  const account = await prisma.metaAdAccount.findFirst({ where: { id: adAccountId }, select: { id: true, name: true, currency: true } });
  if (!account) throw new AppError('Ad account not found', 404, 'META_ACCOUNT_NOT_FOUND');
  const store = await getCurrency();
  const userId = await getSystemUserId();
  const result: MetaLedgerResult = { posted: 0, adjusted: 0, unchanged: 0, waitingForRate: 0 };

  for (const ymd of [...new Set(dates)].sort()) {
    const day = utcDateOfYmd(ymd);
    const subjectId = `${account.id}:${ymd}`;
    const sum = await prisma.metaSpendDay.aggregate({ where: { adAccountId: account.id, date: day }, _sum: { spend: true } });
    const original = Money.orZero(sum._sum.spend);
    const existing = await prisma.expense.findFirst({ where: { metaAdAccountId: account.id, expenseDate: day } });

    // A day with no spend and no row needs no rate. Otherwise the day's rate (1 for the same currency).
    let rate: Money.Money | null = Money.parse(1);
    if (account.currency !== store && !(original.isZero() && !existing)) {
      rate = (await rateOn(tenantId, account.currency, store, ymd))?.rate ?? null;
    }
    if (!rate) {
      result.waitingForRate += 1;
      const open = await prisma.finding.findFirst({ where: { type: 'fx_missing', status: 'open', subjectType: FINDING_SUBJECT, subjectId } });
      if (!open) {
        await prisma.finding.create({
          data: {
            type: 'fx_missing', subjectType: FINDING_SUBJECT, subjectId, tenantId,
            note: `No ${account.currency} to ${store} rate for ${ymd}. Meta spend for that day is not in the ledger yet. Add the rate in Settings, FX.`,
          },
        });
      }
      continue;
    }

    const amount = convertSpend(original, rate);
    const description = `Meta ads: ${account.name}`;
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.finding.updateMany({
        where: { type: 'fx_missing', status: 'open', subjectType: FINDING_SUBJECT, subjectId },
        data: { status: 'closed', resolvedAt: new Date(), explanation: 'The rate was added and the spend is posted.' },
      });
      if (!existing) {
        if (!amount.gt(0)) return 'unchanged' as const;
        const created = await tx.expense.create({
          data: {
            category: META_EXPENSE_CATEGORY, amount, description, expenseDate: day, source: 'meta',
            originalCurrency: account.currency, originalAmount: original, fxRate: rate, metaAdAccountId: account.id,
          },
        });
        const entry = await GLAutomationService.createMetaSpendGLEntry(tx as any, { expenseId: created.id, seq: 1, delta: amount, description, userId, entryDate: day });
        await tx.expense.update({ where: { id: created.id }, data: { journalEntryId: entry?.id } });
        return 'posted' as const;
      }
      const delta = Money.sub(amount, existing.amount);
      if (delta.isZero()) return 'unchanged' as const;
      const seq = (await tx.journalEntry.count({ where: { sourceType: 'expense', sourceId: existing.id } })) + 1;
      await GLAutomationService.createMetaSpendGLEntry(tx as any, { expenseId: existing.id, seq, delta, description, userId, entryDate: day });
      await tx.expense.update({ where: { id: existing.id }, data: { amount, originalAmount: original, fxRate: rate } });
      return 'adjusted' as const;
    }, TRANSACTION_CONFIG);
    result[outcome] += 1;
  }
  return result;
}
