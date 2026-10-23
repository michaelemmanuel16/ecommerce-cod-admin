import logger from '../../utils/logger';
import type { Money } from '../../utils/money';

/**
 * The hook other code subscribes to when an online payment is settled (F-406).
 * Settlement emits once, after its transaction commits. Subscribers (the ledger poster today) run on their own:
 * an error in one is logged and never reaches settlement, and the order and payment are never undone.
 */
export interface PaymentSettledEvent {
  tenantId: string;
  orderId: number;
  provider: string;
  reference: string;
  currency: string;
  /** Major units. */
  amount: Money;
  /** Provider fee, major units. 0 when the provider gave none (then feeUnknown is true). */
  fee: Money;
  feeUnknown: boolean;
  channel: string | null;
  paidAt: Date;
  orderType: string;
  method: string;
}

type Subscriber = (event: PaymentSettledEvent) => Promise<void> | void;

const subscribers: Subscriber[] = [];

export function onPaymentSettled(fn: Subscriber): void {
  subscribers.push(fn);
}

/** Test helper: drops every subscriber. */
export function clearPaymentSettledSubscribers(): void {
  subscribers.length = 0;
}

export async function emitPaymentSettled(event: PaymentSettledEvent): Promise<void> {
  await Promise.all(
    subscribers.map(async (fn) => {
      try {
        await fn(event);
      } catch (err: any) {
        logger.error('Payment-settled subscriber failed', { tenantId: event.tenantId, orderId: event.orderId, reference: event.reference, error: err?.message });
      }
    }),
  );
}
