import prisma from '../../utils/prisma';
import logger from '../../utils/logger';
import { runInTenant } from '../../utils/tenantContext';
import * as Money from '../../utils/money';
import { GLAutomationService } from '../glAutomationService';
import { getSystemUserId } from '../systemUserService';
import { JournalSourceType } from '@prisma/client';
import { openFindingOnce } from '../findingService';
import { onPaymentSettled, type PaymentSettledEvent } from './settlementHooks';

/**
 * First subscriber of the payment-settled hook (F-406): books a settled digital sale to the ledger
 * (DR 1030 / CR 4020, fee DR 5060 / CR 1030) dated the payment day.
 * Posting is idempotent per order, retried with backoff, and a final failure opens a `ledger_post_failed`
 * Finding. The order and the payment are never undone.
 */
const RETRY_DELAYS_MS = [500, 2000];

export interface LedgerPosterOptions {
  /** Waits between attempts. The attempt count is delays + 1. Tests pass short ones. */
  delaysMs?: number[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function postDigitalSale(event: PaymentSettledEvent): Promise<void> {
  const userId = await getSystemUserId(event.tenantId);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.journalEntry.findFirst({
      where: { sourceType: JournalSourceType.digital_sale, sourceId: event.orderId },
      select: { id: true },
    });
    if (existing) return;
    await new GLAutomationService().createDigitalSaleEntry(tx as any, event.orderId, event.amount, event.fee, userId, event.paidAt);
  });
}

export async function postPaymentToLedger(event: PaymentSettledEvent, opts: LedgerPosterOptions = {}): Promise<void> {
  if (event.orderType !== 'digital') {
    // Prepaid physical orders are off for every tenant. Their ledger treatment comes with Finance (F-406).
    logger.warn('Ledger poster: online payment on a physical order — nothing posted', {
      tenantId: event.tenantId,
      orderId: event.orderId,
      reference: event.reference,
    });
    return;
  }

  const delays = opts.delaysMs ?? RETRY_DELAYS_MS;
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      await runInTenant(event.tenantId, () => postDigitalSale(event));
      return;
    } catch (err) {
      lastError = err;
      logger.warn('Ledger poster: attempt failed', { tenantId: event.tenantId, orderId: event.orderId, attempt: attempt + 1, error: (err as Error)?.message });
      if (attempt < delays.length) await sleep(delays[attempt]);
    }
  }

  logger.error('Ledger poster: giving up', { tenantId: event.tenantId, orderId: event.orderId, reference: event.reference, error: (lastError as Error)?.message });
  await runInTenant(event.tenantId, async () => {
    await openFindingOnce({
      tenantId: event.tenantId,
      type: 'ledger_post_failed',
      subjectType: 'order',
      subjectId: String(event.orderId),
      amount: Money.parse(event.amount),
      note: `Ledger entry failed for payment ${event.reference}`,
    });
  });
}

let registered = false;

/** Called once at startup (server.ts). */
export function registerLedgerPoster(): void {
  if (registered) return;
  registered = true;
  onPaymentSettled((event) => postPaymentToLedger(event));
}
