import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import { mcpJson, mcpError, getDateRange } from '../utils';

const financialSummarySchema = z.object({
  period: z.enum(['today', 'week', 'month']).default('today'),
});

export function registerFinancialTools(
  server: McpServer,
  wrapHandler: <T>(handler: (args: T) => Promise<any>) => (args: T) => Promise<any>,
) {
  server.tool(
    'financial_summary',
    'Revenue and collection summary: total revenue, collections received, pending amounts, agent balances.',
    financialSummarySchema.shape,
    wrapHandler(async (args: z.infer<typeof financialSummarySchema>) => {
      try {
        const parsed = financialSummarySchema.parse(args);
        const { start, end } = getDateRange(parsed.period);
        const dateFilter = { createdAt: { gte: start, lte: end } };

        const [revenue, pendingRevenue, expenses, agentBalances] = await Promise.all([
          // Revenue from delivered orders (tenant-scoped via Prisma extension)
          prisma.order.aggregate({
            where: { ...dateFilter, deletedAt: null, status: 'delivered' },
            _sum: { totalAmount: true },
            _count: { id: true },
          }),
          // Pending revenue from undelivered orders
          prisma.order.aggregate({
            where: {
              ...dateFilter,
              deletedAt: null,
              status: { in: ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery'] },
            },
            _sum: { totalAmount: true },
            _count: { id: true },
          }),
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

        return mcpJson({
          period: parsed.period,
          dateRange: { from: start.toISOString(), to: end.toISOString() },
          revenue: {
            delivered: revenue._sum.totalAmount ?? 0,
            deliveredOrders: revenue._count.id,
            pending: pendingRevenue._sum.totalAmount ?? 0,
            pendingOrders: pendingRevenue._count.id,
          },
          expenses: {
            total: expenses._sum.amount ?? 0,
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
