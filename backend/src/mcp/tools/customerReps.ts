import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import { mcpJson, mcpMoneyJson, mcpError, getDateRange, getStoreRange } from '../utils';
import { resolveTenantId } from '../../utils/tenantContext';
import { repRates } from '../../services/kpi/reps';
import { deliveredRevenue } from '../../services/kpi/revenue';

const repsStatusSchema = z.object({});

const repsPerformanceSchema = z.object({
  repId: z.number().int().optional(),
  period: z.enum(['today', 'week', 'month']).default('today'),
});

export function registerCustomerRepTools(
  server: McpServer,
  wrapHandler: <T>(handler: (args: T) => Promise<any>) => (args: T) => Promise<any>,
) {
  server.tool(
    'reps_status',
    'Current workload for all customer/sales reps: orders created today, pending orders, total active orders.',
    repsStatusSchema.shape,
    wrapHandler(async (_args: z.infer<typeof repsStatusSchema>) => {
      try {
        const todayStart = getStoreRange('today').from;

        const [reps, createdTodayCounts, pendingCounts, activeCounts] = await Promise.all([
          prisma.user.findMany({
            where: { role: 'sales_rep', isActive: true },
            select: { id: true, firstName: true, lastName: true, phoneNumber: true },
          }),
          prisma.order.groupBy({
            by: ['customerRepId'],
            where: { deletedAt: null, createdAt: { gte: todayStart } },
            _count: { id: true },
          }),
          prisma.order.groupBy({
            by: ['customerRepId'],
            where: {
              deletedAt: null,
              status: { in: ['pending_confirmation', 'confirmed'] },
            },
            _count: { id: true },
          }),
          prisma.order.groupBy({
            by: ['customerRepId'],
            where: {
              deletedAt: null,
              status: { notIn: ['delivered', 'cancelled', 'returned', 'failed_delivery', 'payment_failed'] },
            },
            _count: { id: true },
          }),
        ]);

        const createdMap = new Map(createdTodayCounts.map((c) => [c.customerRepId, c._count.id]));
        const pendingMap = new Map(pendingCounts.map((c) => [c.customerRepId, c._count.id]));
        const activeMap = new Map(activeCounts.map((c) => [c.customerRepId, c._count.id]));

        const repStats = reps.map((rep) => ({
          id: rep.id,
          name: `${rep.firstName} ${rep.lastName}`,
          phone: rep.phoneNumber,
          createdToday: createdMap.get(rep.id) ?? 0,
          pendingOrders: pendingMap.get(rep.id) ?? 0,
          activeOrders: activeMap.get(rep.id) ?? 0,
        }));

        return mcpJson({
          reps: repStats.sort((a, b) => b.activeOrders - a.activeOrders),
          totalReps: reps.length,
          totalCreatedToday: repStats.reduce((sum, r) => sum + r.createdToday, 0),
          totalPending: repStats.reduce((sum, r) => sum + r.pendingOrders, 0),
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );

  server.tool(
    'reps_performance',
    'Customer rep performance for a period: orders assigned, confirmationRate (confirmed / assigned), deliveredFromConfirmedRate (delivered / closed among the orders the rep confirmed), delivered revenue. Rates are percents, null when there is nothing to divide.',
    repsPerformanceSchema.shape,
    wrapHandler(async (args: z.infer<typeof repsPerformanceSchema>) => {
      try {
        const parsed = repsPerformanceSchema.parse(args);
        const { start, end } = getDateRange(parsed.period);

        const repWhere: any = { role: 'sales_rep', isActive: true };
        if (parsed.repId) repWhere.id = parsed.repId;

        const reps = await prisma.user.findMany({
          where: repWhere,
          select: { id: true, firstName: true, lastName: true },
        });

        // Rates and revenue come from the KPI layer: confirmationRate by customerRepId, deliveredFromConfirmedRate by confirmedById.
        const tenantId = resolveTenantId();
        const to = new Date(end.getTime() + 1); // end is inclusive
        const rangeRates = await repRates(tenantId, start, to);

        const repPerf = await Promise.all(reps.map(async (rep) => {
          const { confirmationRate, deliveredFromConfirmedRate } = rangeRates.rep(rep.id);
          const revenue = await deliveredRevenue(tenantId, start, to, { customerRepId: rep.id });
          return {
            id: rep.id,
            name: `${rep.firstName} ${rep.lastName}`,
            ordersCreated: confirmationRate.detail.placed,
            confirmed: confirmationRate.detail.confirmed,
            confirmationRate: confirmationRate.value,
            closed: deliveredFromConfirmedRate.detail.closed,
            delivered: deliveredFromConfirmedRate.detail.delivered,
            deliveredFromConfirmedRate: deliveredFromConfirmedRate.value,
            revenue: revenue.total.value,
          };
        }));

        return mcpMoneyJson({
          period: parsed.period,
          dateRange: { from: start.toISOString(), to: end.toISOString() },
          reps: repPerf.sort((a, b) => b.ordersCreated - a.ordersCreated),
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );
}
