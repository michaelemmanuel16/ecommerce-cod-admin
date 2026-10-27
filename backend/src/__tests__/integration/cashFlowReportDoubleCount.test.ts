/**
 * M1-T29 characterization, turned into the M5-T27 (F-928) fix test. Delivery posts the order's cash to GL 1015; verifying a
 * deposit moves it to 1010. Cash with partners now reads GL 1015, so a deposit moves money between two buckets and the
 * position (1010 + 1015) does not change. GL 1020 is never added.
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

describe('getCashFlowReport no longer double counts (M5-T27)', () => {
  it('reads cash with partners from GL 1015, the same money the delivered orders posted', async () => {
    const [{ total }] = await prismaBase.$queryRawUnsafe<Array<{ total: string }>>(
      `SELECT COALESCE(SUM(total_amount), 0)::text AS total FROM orders
       WHERE tenant_id = $1 AND status = 'delivered' AND payment_status NOT IN ('reconciled', 'deposited') AND deleted_at IS NULL`, tenantId);
    expect(Money.parse(total).gt(0)).toBe(true);

    const { kpis } = await report();
    expect(Money.toApi(kpis.cashInTransit)).toBe(await balance('1015'));
    expect(Money.toApi(kpis.cashInHand)).toBe('0.00'); // 1010 is still empty
    expect(Money.toApi(kpis.totalCashPosition)).toBe(await balance('1015'));
  });

  it('a deposit moves cash from 1015 to 1010 and the position stays the same; 1020 is not added', async () => {
    const before = (await report()).kpis;

    await runInTenant(tenantId, () => prismaBase.$transaction(async (tx) => {
      const admin = await tx.user.findFirstOrThrow({ where: { tenantId, role: 'admin' } });
      await GLAutomationService.createDepositGLEntry(tx as any, 100, 900_000_001, admin.id);
    }));

    const after = (await report()).kpis;
    expect(Money.toApi(after.cashInHand)).toBe(Money.toApi(Money.add(before.cashInHand, 100)));
    expect(Money.toApi(after.cashInTransit)).toBe(Money.toApi(Money.sub(before.cashInTransit, 100)));
    expect(Money.toApi(after.totalCashPosition)).toBe(Money.toApi(before.totalCashPosition)); // no new "position" from no new cash
    expect(Money.toApi(after.cashAvailableNow)).toBe(Money.toApi(after.cashInHand));
    expect(Money.toApi(after.totalCashPosition)).toBe(Money.toApi(Money.add(after.cashInHand, after.cashInTransit)));
    expect(Money.toApi(after.supplierPayables)).toBe('0.00');
  });
});
