import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import { encodeCursor, decodeCursor, mcpJson, mcpError } from '../utils';

const deliveriesActiveSchema = z.object({
  agentId: z.number().int().optional(),
  status: z.enum(['out_for_delivery', 'ready_for_pickup', 'confirmed', 'preparing']).optional(),
  city: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25).optional(),
  cursor: z.string().optional(),
});

export function registerDeliveryTools(
  server: McpServer,
  wrapHandler: <T>(handler: (args: T) => Promise<any>) => (args: T) => Promise<any>,
) {
  server.tool(
    'deliveries_active',
    'List active deliveries with order and agent info. Filter by agent, status, or city.',
    deliveriesActiveSchema.shape,
    wrapHandler(async (args: z.infer<typeof deliveriesActiveSchema>) => {
      try {
        const parsed = deliveriesActiveSchema.parse(args);
        const limit = parsed.limit ?? 25;

        const where: any = {
          deletedAt: null,
          status: parsed.status ?? { in: ['out_for_delivery', 'ready_for_pickup', 'confirmed', 'preparing'] },
        };

        if (parsed.agentId) where.deliveryAgentId = parsed.agentId;
        if (parsed.city) where.deliveryArea = { contains: parsed.city, mode: 'insensitive' };

        const cursorOption = parsed.cursor
          ? { cursor: { id: decodeCursor(parsed.cursor) }, skip: 1 }
          : {};

        const orders = await prisma.order.findMany({
          where,
          ...cursorOption,
          take: limit + 1,
          orderBy: { createdAt: 'desc' },
          include: {
            customer: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
            deliveryAgent: { select: { id: true, firstName: true, lastName: true } },
          },
        });

        const hasMore = orders.length > limit;
        const results = hasMore ? orders.slice(0, limit) : orders;
        const nextCursor = hasMore ? encodeCursor(results[results.length - 1].id) : undefined;

        return mcpJson({
          deliveries: results.map((o) => ({
            orderId: o.id,
            status: o.status,
            area: o.deliveryArea,
            totalAmount: o.totalAmount,
            customer: o.customer ? `${o.customer.firstName} ${o.customer.lastName}` : null,
            customerPhone: o.customer?.phoneNumber,
            agent: o.deliveryAgent ? `${o.deliveryAgent.firstName} ${o.deliveryAgent.lastName}` : null,
            createdAt: o.createdAt,
          })),
          total: results.length,
          nextCursor,
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );
}
