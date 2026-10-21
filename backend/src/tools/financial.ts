import { z } from 'zod';
import { defineTool, registerToolDef } from './registry';
import { resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { toolQueryService } from '../services/toolQueryService';
import { deliveredRevenue } from '../services/kpi/revenue';
import { pendingRevenue } from '../services/kpi/pending';
import { dateRangeOut, periodField, storeRange, withCurrency, ymdField } from './shared';

registerToolDef(defineTool({
  name: 'financial_summary',
  description: 'Revenue and collection summary: delivered revenue (by delivery date) and delivered count, pending amounts, expenses, agent balances. Also includes digitalRevenue (digital product sales, GL account 4020) and paystackFees (payment gateway fees, GL account 5060) booked in the period. Money is a 2-decimal string. Period custom takes dateFrom and dateTo (inclusive, store-zone days).',
  input: z.object({
    period: periodField(true),
    // custom only: store-zone days, dateTo inclusive
    dateFrom: ymdField.optional(),
    dateTo: ymdField.optional(),
  }),
  money: true,
  handler: async (input) => {
    const { from, to } = storeRange(input.period, input.dateFrom, input.dateTo);
    const tenantId = resolveTenantId();

    const [revenue, pending, { expenses, agentBalances }, gl] = await Promise.all([
      // Delivered revenue from the KPI layer (delivery date)
      deliveredRevenue(tenantId, from, to),
      // Pending revenue: confirmed, not yet delivered (KPI layer)
      pendingRevenue(tenantId, from, to),
      toolQueryService.expensesAndAgentBalances(from, to),
      // GL 4020 digital revenue and GL 5060 Paystack fees
      toolQueryService.digitalRevenueAndFees(from, to),
    ]);

    return withCurrency({
      period: input.period,
      dateRange: dateRangeOut(from, to),
      revenue: {
        delivered: revenue.total.value,
        deliveredOrders: revenue.deliveredOrders.value,
        pending: pending.value.value,
        pendingOrders: pending.orders.value,
      },
      digitalRevenue: Money.toApi(gl.digitalRevenue),
      paystackFees: Money.toApi(gl.paystackFees),
      expenses: {
        total: Money.toApi(Money.orZero(expenses._sum.amount)),
        count: expenses._count.id,
      },
      agentBalances: agentBalances.map((ab) => ({
        agent: `${ab.agent.firstName} ${ab.agent.lastName}`,
        currentBalance: Money.toApi(ab.currentBalance),
        totalCollected: Money.toApi(ab.totalCollected),
        totalDeposited: Money.toApi(ab.totalDeposited),
      })),
    });
  },
}));
