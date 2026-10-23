import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
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

/**
 * Two payouts posted at the same moment can draw the same journal entry number. The entry retry cannot recover inside
 * a Prisma transaction (the failed insert aborts it), so the whole transaction is run again. On the second run the first
 * payout's entry is committed, and a repeated reference ends as the 409 below.
 */
const MAX_ATTEMPTS = 5;
const isAbortedTransaction = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && (error.meta as { code?: string } | undefined)?.code === '25P02';
const isEntryNumberClash = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && JSON.stringify(error.meta?.target ?? '').includes('entry_number');

export async function recordPaystackPayout(input: PaystackPayoutInput, userId: number) {
  const amount = Money.parse(input.amount);

  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const receivable = await tx.account.findFirst({ where: { code: GL_ACCOUNTS.PAYSTACK_RECEIVABLE }, select: { currentBalance: true } });
        const overBalance = amount.gt(Money.orZero(receivable?.currentBalance));

        const description = [`Paystack payout ${input.reference}`, input.note?.trim(), overBalance ? PAYOUT_OVER_BALANCE_WARNING : null].filter(Boolean).join(' - ');
        // externalRef is unique per tenant: a repeated reference fails here, whether it is sequential or parallel.
        const entry = await new GLAutomationService().createPaystackPayoutEntry(tx as any, amount, input.payoutDate, description, userId, input.reference);

        return {
          entry: { id: entry.id, entryNumber: entry.entryNumber, entryDate: entry.entryDate, description: entry.description },
          ...(overBalance ? { warning: PAYOUT_OVER_BALANCE_WARNING } : {}),
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && JSON.stringify(error.meta?.target ?? '').includes('external_ref')) {
        throw new AppError(`Payout ${input.reference} is already recorded`, 409, 'PAYOUT_DUPLICATE');
      }
      if (attempt < MAX_ATTEMPTS && (isAbortedTransaction(error) || isEntryNumberClash(error))) continue;
      throw error;
    }
  }
}
