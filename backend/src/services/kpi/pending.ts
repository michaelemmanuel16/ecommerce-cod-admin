/**
 * Pending revenue (M1-T26): value of orders placed in [from, to) that are confirmed but not yet delivered
 * (confirmed, preparing, ready_for_pickup, out_for_delivery). It is not revenue (F-250): it is money still in
 * the pipeline. Placed-date basis, so it reads like the order counts next to it. Used by the MCP financial_summary tool.
 */
import prisma from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import * as Money from '../../utils/money';
import { getCurrency } from '../../utils/currency';
import type { OrderStatus } from '@prisma/client';
import type { KpiResult } from './types';

export const PENDING_STATUSES: OrderStatus[] = ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery'];

export interface PendingRevenue {
  value: KpiResult<string>;
  orders: KpiResult<number>;
}

export async function pendingRevenue(tenantId: string, from: Date, to: Date): Promise<PendingRevenue> {
  return runInTenant(tenantId, async () => {
    const [currency, agg] = await Promise.all([
      getCurrency(),
      prisma.order.aggregate({
        where: { deletedAt: null, status: { in: PENDING_STATUSES }, createdAt: { gte: from, lt: to } },
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
    ]);
    const meta = { dateBasis: 'createdAt' as const, formulaId: 'revenue.pending.v1', from: from.toISOString(), to: to.toISOString(), asOf: new Date().toISOString() };
    return {
      value: { name: 'Pending revenue', value: Money.toApi(Money.orZero(agg._sum.totalAmount)), unit: 'money', currency, ...meta },
      orders: { name: 'Pending orders', value: agg._count._all, unit: 'count', ...meta },
    };
  });
}
