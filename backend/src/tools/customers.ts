import { z } from 'zod';
import { defineTool, registerToolDef } from './registry';
import { AppError } from '../middleware/errorHandler';
import { toolQueryService } from '../services/toolQueryService';
import { cursorId, limitField, nextCursorOf } from './shared';

registerToolDef(defineTool({
  name: 'customers_lookup',
  description: 'Find customers by phone number or name. Returns customer info with order history summary.',
  input: z.object({
    phone: z.string().optional(),
    name: z.string().optional(),
    limit: limitField,
    cursor: z.string().optional(),
  }),
  handler: async (input) => {
    if (!input.phone && !input.name) throw new AppError('At least one of phone or name is required', 400);
    const { customers, hasMore } = await toolQueryService.lookupCustomers({
      phone: input.phone,
      name: input.name,
      limit: input.limit,
      cursorId: cursorId(input.cursor),
    });
    return {
      customers: customers.map((c) => ({
        id: c.id,
        name: `${c.firstName} ${c.lastName}`,
        phone: c.phoneNumber,
        alternatePhone: c.alternatePhone,
        address: c.address,
        state: c.state,
        totalOrders: c._count.orders,
        customerSince: c.createdAt.toISOString(),
      })),
      total: customers.length,
      nextCursor: nextCursorOf(customers, hasMore),
    };
  },
}));
