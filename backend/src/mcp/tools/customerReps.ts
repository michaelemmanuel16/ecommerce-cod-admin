import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import { mcpJson, mcpError, getDateRange } from '../utils';

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
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

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
    'Customer rep performance: orders created, confirmed rate, total revenue generated, for a given period.',
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

        const dateFilter = { createdAt: { gte: start, lte: end } };

        const [totalCounts, deliveredCounts, cancelledCounts, revenueSums] = await Promise.all([
          prisma.order.groupBy({
            by: ['customerRepId'],
            where: { ...dateFilter, deletedAt: null },
            _count: { id: true },
          }),
          prisma.order.groupBy({
            by: ['customerRepId'],
            where: { ...dateFilter, deletedAt: null, status: 'delivered' },
            _count: { id: true },
          }),
          prisma.order.groupBy({
            by: ['customerRepId'],
            where: { ...dateFilter, deletedAt: null, status: { in: ['cancelled', 'returned', 'failed_delivery'] } },
            _count: { id: true },
          }),
          prisma.order.groupBy({
            by: ['customerRepId'],
            where: { ...dateFilter, deletedAt: null, status: 'delivered' },
            _sum: { totalAmount: true },
          }),
        ]);

        const totalMap = new Map(totalCounts.map((c) => [c.customerRepId, c._count.id]));
        const deliveredMap = new Map(deliveredCounts.map((c) => [c.customerRepId, c._count.id]));
        const cancelledMap = new Map(cancelledCounts.map((c) => [c.customerRepId, c._count.id]));
        const revenueMap = new Map(revenueSums.map((c) => [c.customerRepId, c._sum.totalAmount]));

        const repPerf = reps.map((rep) => {
          const total = totalMap.get(rep.id) ?? 0;
          const delivered = deliveredMap.get(rep.id) ?? 0;
          const cancelled = cancelledMap.get(rep.id) ?? 0;
          const successRate = total > 0 ? parseFloat(((delivered / total) * 100).toFixed(1)) : 0;

          return {
            id: rep.id,
            name: `${rep.firstName} ${rep.lastName}`,
            ordersCreated: total,
            delivered,
            cancelled,
            successRate: `${successRate}%`,
            revenue: revenueMap.get(rep.id) ?? 0,
          };
        });

        return mcpJson({
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
