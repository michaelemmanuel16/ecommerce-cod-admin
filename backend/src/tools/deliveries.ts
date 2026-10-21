import { z } from 'zod';
import { defineTool, registerToolDef } from './registry';
import * as Money from '../utils/money';
import { ACTIVE_DELIVERY_STATUSES, toolQueryService } from '../services/toolQueryService';
import { cursorId, limitField, nextCursorOf, withCurrency } from './shared';

registerToolDef(defineTool({
  name: 'deliveries_active',
  description: 'List active deliveries with order and agent info. Filter by agent, status, or city.',
  input: z.object({
    agentId: z.number().int().optional(),
    status: z.enum(ACTIVE_DELIVERY_STATUSES).optional(),
    city: z.string().optional(),
    limit: limitField,
    cursor: z.string().optional(),
  }),
  money: true,
  handler: async (input) => {
    const { orders, hasMore } = await toolQueryService.activeDeliveries({
      status: input.status,
      agentId: input.agentId,
      city: input.city,
      limit: input.limit,
      cursorId: cursorId(input.cursor),
    });
    return withCurrency({
      deliveries: orders.map((o) => ({
        orderId: o.id,
        status: o.status,
        area: o.deliveryArea,
        totalAmount: Money.toApi(o.totalAmount),
        customer: o.customer ? `${o.customer.firstName} ${o.customer.lastName}` : null,
        customerPhone: o.customer?.phoneNumber,
        agent: o.deliveryAgent ? `${o.deliveryAgent.firstName} ${o.deliveryAgent.lastName}` : null,
        createdAt: o.createdAt.toISOString(),
      })),
      total: orders.length,
      nextCursor: nextCursorOf(orders, hasMore),
    });
  },
}));
