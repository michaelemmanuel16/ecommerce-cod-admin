import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import prisma from '../../utils/prisma';
import { mcpJson, mcpError } from '../utils';

const productsInventorySchema = z.object({
  productId: z.number().int().optional(),
  lowStockOnly: z.boolean().default(false).optional(),
});

export function registerProductTools(
  server: McpServer,
  wrapHandler: <T>(handler: (args: T) => Promise<any>) => (args: T) => Promise<any>,
) {
  server.tool(
    'products_inventory',
    'Product stock levels. Optionally filter by product ID or show only low-stock items.',
    productsInventorySchema.shape,
    wrapHandler(async (args: z.infer<typeof productsInventorySchema>) => {
      try {
        const parsed = productsInventorySchema.parse(args);
        const where: any = { isActive: true };

        if (parsed.productId) where.id = parsed.productId;

        const products = await prisma.product.findMany({
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
        });

        let results = products.map((p) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          price: p.price,
          stock: p.stockQuantity,
          lowStockThreshold: p.lowStockThreshold,
          isLowStock: p.lowStockThreshold ? p.stockQuantity <= p.lowStockThreshold : false,
        }));

        if (parsed.lowStockOnly) {
          results = results.filter((p) => p.isLowStock);
        }

        return mcpJson({
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
