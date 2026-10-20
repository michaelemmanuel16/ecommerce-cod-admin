import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import { mcpJson, mcpError, getStoreRange, inclusiveEnd } from '../utils';
import { resolveTenantId } from '../../utils/tenantContext';
import { partnerRates } from '../../services/kpi/partners';

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
        const today = getStoreRange('today');

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
            where: { status: 'delivered', deletedAt: null, deliveryDate: { gte: today.from, lt: today.to } },
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
    'Delivery agent performance for orders placed in a period (store-zone days): assigned, delivered, failed, returned, closed, and deliverySuccessRate (delivered / closed, a percent, null when the agent has no closed order).',
    agentsPerformanceSchema.shape,
    wrapHandler(async (args: z.infer<typeof agentsPerformanceSchema>) => {
      try {
        const parsed = agentsPerformanceSchema.parse(args);
        const { from, to } = getStoreRange(parsed.period);

        // Get agents to report on
        const agentWhere: any = { role: 'delivery_agent', isActive: true };
        if (parsed.agentId) agentWhere.id = parsed.agentId;

        const [agents, partners] = await Promise.all([
          prisma.user.findMany({
            where: agentWhere,
            select: { id: true, firstName: true, lastName: true },
          }),
          // Delivery success rate from the KPI layer: orders placed in the range, outcome by current status (D21)
          partnerRates(resolveTenantId(), from, to),
        ]);
        const byPartner = new Map(partners.map((p) => [p.partnerId, p]));

        const agentPerf = agents.map((agent) => {
          const row = byPartner.get(agent.id);
          const detail = row?.deliverySuccessRate.detail ?? {};
          return {
            id: agent.id,
            name: `${agent.firstName} ${agent.lastName}`,
            assigned: row?.assigned ?? 0,
            delivered: detail.delivered ?? 0,
            failed: detail.failed ?? 0,
            returned: detail.returned ?? 0,
            closed: detail.closed ?? 0,
            deliverySuccessRate: row?.deliverySuccessRate.value ?? null,
          };
        });

        return mcpJson({
          period: parsed.period,
          dateRange: { from: from.toISOString(), to: inclusiveEnd(to).toISOString() },
          agents: agentPerf.sort((a, b) => b.delivered - a.delivered),
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );
}
