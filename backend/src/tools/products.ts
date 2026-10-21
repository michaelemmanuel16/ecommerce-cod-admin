import { z } from 'zod';
import { defineTool, registerToolDef } from './registry';
import { resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { toolQueryService } from '../services/toolQueryService';
import { productDeliveredUnits } from '../services/kpi/products';
import { dateRangeOut, storeRange, withCurrency } from './shared';

registerToolDef(defineTool({
  name: 'products_inventory',
  description: 'Product stock levels with delivered units for a period (default month to date, store-zone days; delivered orders only, returns excluded). Optionally filter by product ID or show only low-stock items.',
  input: z.object({
    productId: z.number().int().optional(),
    lowStockOnly: z.boolean().default(false),
    period: z.enum(['today', 'week', 'month']).default('month'),
  }),
  money: true,
  handler: async (input) => {
    const { period } = input;
    const { from, to } = storeRange(period);
    const [products, delivered] = await Promise.all([
      toolQueryService.activeProducts(input.productId),
      productDeliveredUnits(resolveTenantId(), input.productId ?? 'all', from, to),
    ]);
    const unitsBy = new Map((delivered.byProduct ?? []).map((l) => [l.productId, l.units]));

    let results = products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      price: Money.toApi(p.price),
      stock: p.stockQuantity,
      deliveredUnits: input.productId ? delivered.units.value : unitsBy.get(p.id) ?? 0,
      lowStockThreshold: p.lowStockThreshold,
      isLowStock: p.lowStockThreshold ? p.stockQuantity <= p.lowStockThreshold : false,
    }));

    if (input.lowStockOnly) results = results.filter((p) => p.isLowStock);

    return withCurrency({
      period,
      dateRange: dateRangeOut(from, to),
      products: results,
      totalProducts: results.length,
      lowStockCount: results.filter((p) => p.isLowStock).length,
    });
  },
}));
