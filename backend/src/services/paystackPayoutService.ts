import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { GL_ACCOUNTS } from '../config/glAccounts';
import { GLAutomationService } from './glAutomationService';

/**
 * Paystack pays the bank later than the sale (F-934). A payout posts DR 1010 / CR 1030 dated the payout day,
 * so 1030 stops only growing. The reference is the payout's id at Paystack; one tenant cannot post it twice.
 * A payout above the 1030 balance is allowed with a warning (a sale may not be booked yet).
 */
export interface PaystackPayoutInput {
  /** Major units, a positive decimal string. */
  amount: string;
  payoutDate: Date;
  reference: string;
  note?: string;
}

export const PAYOUT_OVER_BALANCE_WARNING = 'Payout is larger than the Paystack receivable balance';

export async function recordPaystackPayout(input: PaystackPayoutInput, userId: number) {
  const tenantId = resolveTenantId();
  const amount = Money.parse(input.amount);
  // The reference sits in the entry description, in brackets, so the duplicate check matches it exactly.
  const tag = `Paystack payout [${input.reference}]`;

  return prisma.$transaction(async (tx) => {
    // Two requests with the same reference queue here, so the second one sees the first one's entry.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${tenantId}:paystack_payout:${input.reference}`}))`;

    const duplicate = await tx.journalEntry.findFirst({
      where: { sourceType: 'paystack_payout', isVoided: false, description: { startsWith: tag } },
      select: { id: true },
    });
    if (duplicate) throw new AppError(`Payout ${input.reference} is already recorded`, 409, 'PAYOUT_DUPLICATE');

    const receivable = await tx.account.findFirst({ where: { code: GL_ACCOUNTS.PAYSTACK_RECEIVABLE }, select: { currentBalance: true } });
    const balance = Money.orZero(receivable?.currentBalance);
    const overBalance = amount.gt(balance);

    const description = [tag, input.note?.trim(), overBalance ? PAYOUT_OVER_BALANCE_WARNING : null].filter(Boolean).join(' - ');
    const entry = await new GLAutomationService().createPaystackPayoutEntry(tx as any, amount, input.payoutDate, description, userId);

    return {
      entry: { id: entry.id, entryNumber: entry.entryNumber, entryDate: entry.entryDate, description: entry.description },
      ...(overBalance ? { warning: PAYOUT_OVER_BALANCE_WARNING } : {}),
    };
  });
}
