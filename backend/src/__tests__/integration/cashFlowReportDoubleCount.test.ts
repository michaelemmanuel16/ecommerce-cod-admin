/**
 * M1-T29 (F-928): characterization test for getCashFlowReport. It asserts TODAY's behaviour, double count included,
 * so M5 sees the test fail on purpose when it fixes the report. No fix here.
 *
 * What the report does: `kpis.cashInTransit` is a sum over ORDERS (delivered, paymentStatus not reconciled/deposited),
 * while `kpis.cashInHand` reads GL 1010 and GL 1015 ("Cash in Transit") is fetched and dropped. Delivery posts the
 * order's cash to 1015. Verifying an agent collection moves it from 1015 to 1010 but leaves the order's paymentStatus
 * `collected`, so the same cash sits in the order bucket (cashInTransit) and in 1010 (cashInHand), and
 * totalCashPosition counts it twice.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';
import { runInTenant } from '../../utils/tenantContext';
import { FinancialService } from '../../services/financialService';
import { GLAutomationService } from '../../services/glAutomationService';
import * as Money from '../../utils/money';

jest.setTimeout(180_000);

let tenantId: string;

const report = () => runInTenant(tenantId, () => new FinancialService().getCashFlowReport());

async function balance(code: string): Promise<string> {
  const account = await prismaBase.account.findFirstOrThrow({ where: { tenantId, code } });
  return Money.toApi(account.currentBalance);
}

beforeAll(async () => {
  tenantId = (await seedFixture(prismaBase)).tenantId;
});

afterAll(async () => {
  await deleteFixtureRows(prismaBase, tenantId);
  await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  await prismaBase.$disconnect();
});

describe('getCashFlowReport double count (M1-T29, characterization)', () => {
  it('holds the delivered-not-deposited orders in the order bucket and in GL 1015', async () => {
    const [{ total }] = await prismaBase.$queryRawUnsafe<Array<{ total: string }>>(
      `SELECT COALESCE(SUM(total_amount), 0)::text AS total FROM orders
       WHERE tenant_id = $1 AND status = 'delivered' AND payment_status NOT IN ('reconciled', 'deposited') AND deleted_at IS NULL`, tenantId);
    expect(Money.parse(total).gt(0)).toBe(true);

    const { kpis } = await report();
    expect(Money.toApi(kpis.cashInTransit)).toBe(Money.toApi(total)); // order bucket
    expect(await balance('1015')).toBe(Money.toApi(total)); // the same orders in the ledger
    expect(Money.toApi(kpis.cashInHand)).toBe('0.00'); // 1010 is still empty
  });

  it('counts the same cash twice once a collection moves it from 1015 to 1010', async () => {
    const before = (await report()).kpis;
    const order = await prismaBase.order.findFirstOrThrow({ where: { tenantId, status: 'delivered' }, select: { id: true } });

    // Verify a 100.00 collection: GL 1015 -> 1010. The order stays delivered / `collected`, so the order bucket is unchanged.
    await runInTenant(tenantId, () => prismaBase.$transaction(async (tx) => {
      const admin = await tx.user.findFirstOrThrow({ where: { tenantId, role: 'admin' } });
      await GLAutomationService.createCollectionVerificationEntry(tx as any, { id: 900_000_001, orderId: order.id, amount: 100 }, admin.id);
    }));

    const after = (await report()).kpis;
    expect(Money.toApi(after.cashInTransit)).toBe(Money.toApi(before.cashInTransit)); // order bucket still holds it
    expect(Money.toApi(after.cashInHand)).toBe(Money.toApi(Money.add(before.cashInHand, 100))); // and 1010 holds it too
    expect(Money.toApi(after.totalCashPosition)).toBe(Money.toApi(Money.add(before.totalCashPosition, 100))); // 100.00 of new "position" from no new cash
    expect(await balance('1015')).toBe(Money.toApi(Money.sub(before.cashInTransit, 100))); // the ledger says 1015 shrank by 100.00
  });
});
