import { z } from 'zod';
import { defineTool, registerToolDef } from './registry';
import { resolveTenantId } from '../utils/tenantContext';
import { toolQueryService } from '../services/toolQueryService';
import { partnerRates } from '../services/kpi/partners';
import { dateRangeOut, storeRange } from './shared';

/**
 * Delivery agent (partner) tools. The rate is deliverySuccessRate from the KPI layer: delivered over
 * closed orders (delivered + failed + returned).
 */

registerToolDef(defineTool({
  name: 'agents_status',
  description: 'Current workload for all delivery agents: pending deliveries, active deliveries, completed today.',
  input: z.object({}),
  handler: async () => {
    const today = storeRange('today');
    const { agents, pending, active, completedToday } = await toolQueryService.agentWorkload(today.from, today.to);

    const agentStats = agents.map((agent) => {
      const pendingCount = pending.get(agent.id) ?? 0;
      const activeCount = active.get(agent.id) ?? 0;
      return {
        id: agent.id,
        name: `${agent.firstName} ${agent.lastName}`,
        phone: agent.phoneNumber,
        pending: pendingCount,
        active: activeCount,
        completedToday: completedToday.get(agent.id) ?? 0,
        totalLoad: pendingCount + activeCount,
      };
    });

    return {
      agents: agentStats.sort((a, b) => b.totalLoad - a.totalLoad),
      totalAgents: agents.length,
      totalPending: agentStats.reduce((sum, a) => sum + a.pending, 0),
      totalActive: agentStats.reduce((sum, a) => sum + a.active, 0),
    };
  },
}));

registerToolDef(defineTool({
  name: 'agents_performance',
  description: 'Delivery agent performance for orders placed in a period (store-zone days): assigned, delivered, failed, returned, closed, and deliverySuccessRate (delivered / closed, a percent, null when the agent has no closed order).',
  input: z.object({
    agentId: z.number().int().optional(),
    period: z.enum(['today', 'week', 'month']).default('today'),
  }),
  handler: async (input) => {
    const { from, to } = storeRange(input.period);
    const [agents, partners] = await Promise.all([
      toolQueryService.deliveryAgents(input.agentId),
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

    return {
      period: input.period,
      dateRange: dateRangeOut(from, to),
      agents: agentPerf.sort((a, b) => b.delivered - a.delivered),
    };
  },
}));
