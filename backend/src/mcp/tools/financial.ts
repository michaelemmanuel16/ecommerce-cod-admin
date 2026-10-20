import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import { mcpMoneyJson, mcpError, getStoreRange, inclusiveEnd } from '../utils';
import * as Money from '../../utils/money';
import { resolveTenantId } from '../../utils/tenantContext';
import { deliveredRevenue } from '../../services/kpi/revenue';
import { pendingRevenue } from '../../services/kpi/pending';

const financialSummarySchema = z.object({
  period: z.enum(['today', 'week', 'month', 'custom']).default('today'),
  // custom only: store-zone days, dateTo inclusive
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export function registerFinancialTools(
  server: McpServer,
  wrapHandler: <T>(handler: (args: T) => Promise<any>) => (args: T) => Promise<any>,
) {
  server.tool(
    'financial_summary',
    'Revenue and collection summary: delivered revenue (by delivery date) and delivered count, pending amounts, expenses, agent balances. Money is a 2-decimal string. Period custom takes dateFrom and dateTo (inclusive, store-zone days).',
    financialSummarySchema.shape,
    wrapHandler(async (args: z.infer<typeof financialSummarySchema>) => {
      try {
        const parsed = financialSummarySchema.parse(args);
        const { from: start, to: end } = getStoreRange(parsed.period, parsed.dateFrom, parsed.dateTo);
        const dateFilter = { createdAt: { gte: start, lt: end } };

        const [revenue, pending, expenses, agentBalances] = await Promise.all([
          // Delivered revenue from the KPI layer (delivery date)
          deliveredRevenue(resolveTenantId(), start, end),
          // Pending revenue: confirmed, not yet delivered (KPI layer)
          pendingRevenue(resolveTenantId(), start, end),
          // Expenses (tenant-scoped via Prisma extension)
          prisma.expense.aggregate({
            where: dateFilter,
            _sum: { amount: true },
            _count: { id: true },
          }),
          // Agent balances — AgentBalance has tenantId and is in TENANT_SCOPED_MODELS via extension.
          // We also filter through the agent relation to get only active delivery agents.
          prisma.agentBalance.findMany({
            where: {
              agent: { role: 'delivery_agent', isActive: true },
            },
            select: {
              agentId: true,
              currentBalance: true,
              totalCollected: true,
              totalDeposited: true,
              agent: { select: { firstName: true, lastName: true } },
            },
          }),
        ]);

        return mcpMoneyJson({
          period: parsed.period,
          dateRange: { from: start.toISOString(), to: inclusiveEnd(end).toISOString() },
          revenue: {
            delivered: revenue.total.value,
            deliveredOrders: revenue.deliveredOrders.value,
            pending: pending.value.value,
            pendingOrders: pending.orders.value,
          },
          expenses: {
            total: Money.orZero(expenses._sum.amount),
            count: expenses._count.id,
          },
          agentBalances: agentBalances.map((ab) => ({
            agent: `${ab.agent.firstName} ${ab.agent.lastName}`,
            currentBalance: ab.currentBalance,
            totalCollected: ab.totalCollected,
            totalDeposited: ab.totalDeposited,
          })),
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );
}
