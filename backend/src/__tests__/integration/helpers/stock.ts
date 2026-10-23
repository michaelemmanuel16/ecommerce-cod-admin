import { prismaBase } from '../../../utils/prisma';

/**
 * Test helper (M4-T07): puts units on hand at a location, the way stockService would, for a suite that builds its own
 * tenant. Writes through the un-extended client. Creates the location on first use. Also sets the product cache.
 * Not for application code: the grep test (stockWriteGrep.test.ts) does not scan __tests__.
 */
export async function stockUp(
  tenantId: string,
  productId: number,
  quantity: number,
  where: { locationId?: number; name?: string; type?: 'own_store' | 'partner_3pl' | 'agent'; userId?: number } = {},
): Promise<number> {
  let locationId = where.locationId;
  if (locationId == null) {
    const name = where.name ?? 'Test store';
    const existing = await prismaBase.stockLocation.findFirst({ where: { tenantId, name } });
    locationId = existing?.id ?? (await prismaBase.stockLocation.create({ data: { tenantId, name, type: where.type ?? 'own_store', userId: where.userId } })).id;
  }
  await prismaBase.stockLevel.upsert({
    where: { locationId_productId: { locationId, productId } },
    create: { tenantId, locationId, productId, quantity },
    update: { quantity: { increment: quantity } },
  });
  await syncCache(productId);
  return locationId;
}

/** Product.stockQuantity = sum of the levels at active physical locations. */
export async function syncCache(productId: number): Promise<void> {
  const sum = await prismaBase.stockLevel.aggregate({ _sum: { quantity: true }, where: { productId, location: { isActive: true, type: { not: 'in_transit' } } } });
  await prismaBase.product.update({ where: { id: productId }, data: { stockQuantity: sum._sum.quantity ?? 0 } });
}

/** On-hand units of a product at one location, read straight from the table. */
export async function levelAt(locationId: number, productId: number): Promise<number> {
  return (await prismaBase.stockLevel.findUnique({ where: { locationId_productId: { locationId, productId } } }))?.quantity ?? 0;
}
