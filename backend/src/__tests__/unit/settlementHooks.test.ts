/** M3b-T07 (F-406): the payment-settled hook calls every subscriber with the payload, and a failing subscriber never throws. */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import '../mocks/logger.mock';
import { onPaymentSettled, emitPaymentSettled, clearPaymentSettledSubscribers, PaymentSettledEvent } from '../../services/payments/settlementHooks';
import logger from '../../utils/logger';
import * as Money from '../../utils/money';

const event: PaymentSettledEvent = {
  tenantId: 'tenant-1',
  orderId: 42,
  provider: 'paystack',
  reference: 'ref_1',
  currency: 'GHS',
  amount: Money.parse('50.00'),
  fee: Money.parse('0.75'),
  feeUnknown: false,
  channel: 'card',
  paidAt: new Date('2026-10-20T10:00:00Z'),
  orderType: 'digital',
  method: 'online_full',
};

describe('payment-settled hook', () => {
  beforeEach(() => clearPaymentSettledSubscribers());

  it('gives each subscriber the whole payload, amounts as Decimal major units', async () => {
    const seen: PaymentSettledEvent[] = [];
    const seenToo: PaymentSettledEvent[] = [];
    onPaymentSettled((e) => { seen.push(e); });
    onPaymentSettled(async (e) => { seenToo.push(e); });

    await emitPaymentSettled(event);

    expect(seen).toEqual([event]);
    expect(seenToo).toEqual([event]);
    expect(Object.keys(seen[0]).sort()).toEqual(
      ['amount', 'channel', 'currency', 'fee', 'feeUnknown', 'method', 'orderId', 'orderType', 'paidAt', 'provider', 'reference', 'tenantId'],
    );
    expect(Money.toApi(seen[0].amount)).toBe('50.00');
    expect(Money.toApi(seen[0].fee)).toBe('0.75');
  });

  it('a subscriber that throws is logged and does not stop the others or reach the caller', async () => {
    const after = jest.fn();
    onPaymentSettled(() => { throw new Error('boom'); });
    onPaymentSettled(async () => { throw new Error('async boom'); });
    onPaymentSettled(() => { after(); });

    await expect(emitPaymentSettled(event)).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it('with no subscribers the emit does nothing', async () => {
    await expect(emitPaymentSettled(event)).resolves.toBeUndefined();
  });
});
