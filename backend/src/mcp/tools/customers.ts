import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import { encodeCursor, decodeCursor, mcpJson, mcpError } from '../utils';

const customersLookupSchema = z.object({
  phone: z.string().optional(),
  name: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25).optional(),
  cursor: z.string().optional(),
});

export function registerCustomerTools(
  server: McpServer,
  wrapHandler: <T>(handler: (args: T) => Promise<any>) => (args: T) => Promise<any>,
) {
  server.tool(
    'customers_lookup',
    'Find customers by phone number or name. Returns customer info with order history summary.',
    customersLookupSchema.shape,
    wrapHandler(async (args: z.infer<typeof customersLookupSchema>) => {
      try {
        const parsed = customersLookupSchema.parse(args);
        const limit = parsed.limit ?? 25;

        if (!parsed.phone && !parsed.name) {
          return mcpError('At least one of phone or name is required');
        }

        const where: any = { isActive: true };
        if (parsed.phone) where.phoneNumber = { contains: parsed.phone };
        if (parsed.name) {
          where.OR = [
            { firstName: { contains: parsed.name, mode: 'insensitive' } },
            { lastName: { contains: parsed.name, mode: 'insensitive' } },
          ];
        }

        const cursorOption = parsed.cursor
          ? { cursor: { id: decodeCursor(parsed.cursor) }, skip: 1 }
          : {};

        const customers = await prisma.customer.findMany({
          where,
          ...cursorOption,
          take: limit + 1,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            alternatePhone: true,
            state: true,
            area: true,
            createdAt: true,
            _count: { select: { orders: true } },
          },
        });

        const hasMore = customers.length > limit;
        const results = hasMore ? customers.slice(0, limit) : customers;
        const nextCursor = hasMore ? encodeCursor(results[results.length - 1].id) : undefined;

        return mcpJson({
          customers: results.map((c) => ({
            id: c.id,
            name: `${c.firstName} ${c.lastName}`,
            phone: c.phoneNumber,
            alternatePhone: c.alternatePhone,
            state: c.state,
            area: c.area,
            totalOrders: c._count.orders,
            customerSince: c.createdAt,
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
