import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import { mcpJson, mcpError, getDateRange } from '../utils';

const agentsStatusSchema = z.object({});

const agentsPerformanceSchema = z.object({
  agentId: z.number().int().optional(),
  period: z.enum(['today', 'week', 'month']).default('today'),
});

export function registerAgentTools(
  server: McpServer,
  wrapHandler: <T>(handler: (args: T) => Promise<any>) => (args: T) => Promise<any>,
) {
  server.tool(
    'agents_status',
    'Current workload for all delivery agents: pending deliveries, active deliveries, completed today.',
    agentsStatusSchema.shape,
    wrapHandler(async (_args: z.infer<typeof agentsStatusSchema>) => {
      try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        // Batch queries: 3 groupBy queries instead of N*3 per-agent queries
        const [agents, pendingCounts, activeCounts, completedTodayCounts] = await Promise.all([
          prisma.user.findMany({
            where: { role: 'delivery_agent', isActive: true },
            select: { id: true, firstName: true, lastName: true, phoneNumber: true },
          }),
          prisma.order.groupBy({
            by: ['deliveryAgentId'],
            where: { status: { in: ['confirmed', 'preparing', 'ready_for_pickup'] }, deletedAt: null },
            _count: { id: true },
          }),
          prisma.order.groupBy({
            by: ['deliveryAgentId'],
            where: { status: 'out_for_delivery', deletedAt: null },
            _count: { id: true },
          }),
          prisma.order.groupBy({
            by: ['deliveryAgentId'],
            where: { status: 'delivered', deletedAt: null, updatedAt: { gte: todayStart } },
            _count: { id: true },
          }),
        ]);

        const pendingMap = new Map(pendingCounts.map((c) => [c.deliveryAgentId, c._count.id]));
        const activeMap = new Map(activeCounts.map((c) => [c.deliveryAgentId, c._count.id]));
        const completedMap = new Map(completedTodayCounts.map((c) => [c.deliveryAgentId, c._count.id]));

        const agentStats = agents.map((agent) => {
          const pending = pendingMap.get(agent.id) ?? 0;
          const active = activeMap.get(agent.id) ?? 0;
          return {
            id: agent.id,
            name: `${agent.firstName} ${agent.lastName}`,
            phone: agent.phoneNumber,
            pending,
            active,
            completedToday: completedMap.get(agent.id) ?? 0,
            totalLoad: pending + active,
          };
        });

        return mcpJson({
          agents: agentStats.sort((a, b) => b.totalLoad - a.totalLoad),
          totalAgents: agents.length,
          totalPending: agentStats.reduce((sum, a) => sum + a.pending, 0),
          totalActive: agentStats.reduce((sum, a) => sum + a.active, 0),
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );

  server.tool(
    'agents_performance',
    'Agent performance metrics: deliveries completed, success rate, average delivery time for a period.',
    agentsPerformanceSchema.shape,
    wrapHandler(async (args: z.infer<typeof agentsPerformanceSchema>) => {
      try {
        const parsed = agentsPerformanceSchema.parse(args);
        const { start, end } = getDateRange(parsed.period);

        const dateFilter = { updatedAt: { gte: start, lte: end } };

        // Get agents to report on
        const agentWhere: any = { role: 'delivery_agent', isActive: true };
        if (parsed.agentId) agentWhere.id = parsed.agentId;

        const agents = await prisma.user.findMany({
          where: agentWhere,
          select: { id: true, firstName: true, lastName: true },
        });

        const agentPerf = await Promise.all(
          agents.map(async (agent) => {
            const baseWhere = { deliveryAgentId: agent.id, deletedAt: null, ...dateFilter };

            const [delivered, failed, returned, total] = await Promise.all([
              prisma.order.count({ where: { ...baseWhere, status: 'delivered' } }),
              prisma.order.count({ where: { ...baseWhere, status: 'failed_delivery' } }),
              prisma.order.count({ where: { ...baseWhere, status: 'returned' } }),
              prisma.order.count({
                where: {
                  deliveryAgentId: agent.id,
                  deletedAt: null,
                  status: { in: ['delivered', 'failed_delivery', 'returned'] },
                  ...dateFilter,
                },
              }),
            ]);

            const successRate = total > 0 ? parseFloat(((delivered / total) * 100).toFixed(1)) : 0;

            return {
              id: agent.id,
              name: `${agent.firstName} ${agent.lastName}`,
              delivered,
              failed,
              returned,
              total,
              successRate: `${successRate}%`,
            };
          }),
        );

        return mcpJson({
          period: parsed.period,
          dateRange: { from: start.toISOString(), to: end.toISOString() },
          agents: agentPerf.sort((a, b) => b.delivered - a.delivered),
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );
}
