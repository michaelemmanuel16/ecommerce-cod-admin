import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import { mcpMoneyJson, mcpError, getStoreRange, inclusiveEnd } from '../utils';
import { resolveTenantId } from '../../utils/tenantContext';
import { productDeliveredUnits } from '../../services/kpi/products';

const productsInventorySchema = z.object({
  productId: z.number().int().optional(),
  lowStockOnly: z.boolean().default(false).optional(),
  period: z.enum(['today', 'week', 'month']).default('month').optional(),
});

export function registerProductTools(
  server: McpServer,
  wrapHandler: <T>(handler: (args: T) => Promise<any>) => (args: T) => Promise<any>,
) {
  server.tool(
    'products_inventory',
    'Product stock levels with delivered units for a period (default month to date, store-zone days; delivered orders only, returns excluded). Optionally filter by product ID or show only low-stock items.',
    productsInventorySchema.shape,
    wrapHandler(async (args: z.infer<typeof productsInventorySchema>) => {
      try {
        const parsed = productsInventorySchema.parse(args);
        const where: any = { isActive: true };

        if (parsed.productId) where.id = parsed.productId;

        const period = parsed.period ?? 'month';
        const { from, to } = getStoreRange(period);
        const [products, delivered] = await Promise.all([
          prisma.product.findMany({
            where,
            take: 200, // Reasonable cap — most tenants have <200 products
            select: {
              id: true,
              name: true,
              sku: true,
              price: true,
              stockQuantity: true,
              lowStockThreshold: true,
              isActive: true,
            },
            orderBy: { name: 'asc' },
          }),
          productDeliveredUnits(resolveTenantId(), parsed.productId ?? 'all', from, to),
        ]);
        const unitsBy = new Map((delivered.byProduct ?? []).map((l) => [l.productId, l.units]));

        let results = products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          price: p.price,
          stock: p.stockQuantity,
          deliveredUnits: parsed.productId ? delivered.units.value : unitsBy.get(p.id) ?? 0,
          lowStockThreshold: p.lowStockThreshold,
          isLowStock: p.lowStockThreshold ? p.stockQuantity <= p.lowStockThreshold : false,
        }));

        if (parsed.lowStockOnly) {
          results = results.filter((p) => p.isLowStock);
        }

        return mcpMoneyJson({
          period,
          dateRange: { from: from.toISOString(), to: inclusiveEnd(to).toISOString() },
          products: results,
          totalProducts: results.length,
          lowStockCount: results.filter((p) => p.isLowStock).length,
        });
      } catch (err) {
        return mcpError((err as Error).message);
      }
    }),
  );
}
