/**
 * Cash held by partners (M3-T09, F-204): money the delivery partners and agents collected on delivered orders and
 * have not deposited yet. Read from AgentBalance (collected less deposited, net of the fees a partner keeps).
 * Simple body on purpose: M5 (F-902) replaces the body only; the name, the arguments and the result shape stay.
 * A point-in-time number, not a range: it carries no date range.
 */
import prisma from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import * as Money from '../../utils/money';
import { getCurrency } from '../../utils/currency';
import { kpiMeta, type KpiResult } from './types';

/** The Dashboard's "orders over 8 days" (F-204): cash older than this many days is chased. */
export const CASH_OVERDUE_DAYS = 8;

export async function cashHeldByPartners(tenantId: string): Promise<KpiResult<string>> {
  return runInTenant(tenantId, async () => {
    const now = new Date();
    const overdueBefore = new Date(now.getTime() - CASH_OVERDUE_DAYS * 24 * 60 * 60 * 1000);
    const [currency, held, overdueOrders] = await Promise.all([
      getCurrency(),
      prisma.agentBalance.aggregate({
        where: { currentBalance: { gt: 0 } },
        _sum: { currentBalance: true },
        _count: { _all: true },
      }),
      // The orders behind the cash: delivered, collected by the partner, not yet deposited, delivered more than 8 days ago.
      // (AgentBalance has no order link, so the orders come from Order.paymentStatus 'collected'.)
      prisma.order.count({ where: { deletedAt: null, status: 'delivered', paymentStatus: 'collected', deliveryDate: { lt: overdueBefore } } }),
    ]);
    return {
      name: 'Cash held by partners', value: Money.toApi(Money.orZero(held._sum.currentBalance)), unit: 'money', currency,
      ...kpiMeta(now, now, { dateBasis: 'delivery' as const, formulaId: 'cash.heldByPartners.v1' }),
      detail: { partners: held._count._all, overdueOrders },
    };
  });
}
