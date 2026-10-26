import prisma from '../utils/prisma';
import { runInTenant } from '../utils/tenantContext';
import { forEachTenant } from '../utils/tenantLoop';
import { withSoftDeleted } from '../utils/prismaExtensions';
import * as Money from '../utils/money';
import { getOnHandMany } from './stockService';
import { openFindingOnce } from './findingService';

/**
 * Nightly stock check (F-660, M4-T17). `Product.stockQuantity` is a cache of the sum of on-hand over the active physical
 * locations. For each physical product (archived ones too) whose cache differs from that sum, one open `stock_gap` Finding
 * is opened, keyed by the product (subject `product_cache`), amount = |difference| x cost. A later run only updates the
 * amount of the open Finding. The check never changes a quantity: stockService is the only writer.
 */

export interface StockCheckResult { checked: number; differing: number[] }

export async function checkStockForTenant(tenantId: string): Promise<StockCheckResult> {
  return runInTenant(tenantId, async () => {
    const [products, onHand] = await Promise.all([
      withSoftDeleted(() => prisma.product.findMany({ where: { productType: { not: 'digital' } }, select: { id: true, name: true, sku: true, cogs: true, stockQuantity: true } })),
      getOnHandMany(),
    ]);
    const differing: number[] = [];
    for (const p of products) {
      const real = onHand.get(p.id) ?? 0;
      if (p.stockQuantity === real) continue;
      differing.push(p.id);
      await openFindingOnce({
        tenantId, type: 'stock_gap', subjectType: 'product_cache', subjectId: String(p.id),
        amount: Money.mul(Math.abs(p.stockQuantity - real), Money.orZero(p.cogs)),
        note: `${p.name} (${p.sku}): the stored total is ${p.stockQuantity}, the locations hold ${real}`,
      }, { updateAmount: true });
    }
    return { checked: products.length, differing };
  });
}

/** Once per tenant, each inside its own tenant context. */
export async function runStockCheck(): Promise<void> {
  await forEachTenant('Stock check', async (tenantId) => {
    await checkStockForTenant(tenantId);
  });
}
