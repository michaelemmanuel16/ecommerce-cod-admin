/**
 * Product delivered units (M1-T20, F-610). The one source for "units delivered" per product. Finance, Reports,
 * Products and the MCP tool read it (T25 and T26 repoint them; nothing calls it yet).
 *
 * Units of a range [from, to) = sum of OrderItem.quantity on
 *   physical: orders with status `delivered` and deliveryDate in the range
 *   digital:  orders with status `digital_delivered`, paymentStatus `paid`, totalAmount > 0 and deliveryDate in the
 *             range (D8, F-901)
 * Old rows with no deliveryDate use updatedAt, as revenue does (F-900).
 *
 * Return rule (differs from revenue on purpose): F-610 says "items on cancelled or returned orders are excluded".
 * Revenue keeps a returned order in its delivery month and removes it in its return month. Units never count a
 * returned order at all: its status is `returned`, so it is not in the query in any month. Cancelled, failed and open
 * orders are not either.
 *
 * A free bundled digital item (a digital product line with a total price of 0 inside a physical order) is not counted
 * (D8). Only a line the customer paid for counts.
 *
 * Units are item units, not orders: 376 delivered orders hold 635 units on the fixture. Never compare the two.
 *
 * Revenue per line (`lineRevenue`) is the sum of the real line totals (306 x 249 = 76,194), never a rounded figure
 * (decision R1: the mockup's 76,100 is illustration).
 */
import prisma from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import * as Money from '../../utils/money';
import { getCurrency } from '../../utils/currency';
import type { Prisma } from '@prisma/client';
import type { KpiResult } from './types';

export interface ProductUnitsLine {
  productId: number;
  sku: string;
  name: string;
  units: number;
  /** Sum of the line totals of the counted lines (money string). */
  lineRevenue: string;
}

export interface ProductDeliveredUnits {
  units: KpiResult<number>;
  lineRevenue: KpiResult<string>;
  /** One row per product, most units first. Only for productId 'all'. */
  byProduct?: ProductUnitsLine[];
}

const FORMULA_ID = 'products.deliveredUnits.v1';

export async function productDeliveredUnits(
  tenantId: string,
  productId: number | 'all',
  from: Date,
  to: Date,
): Promise<ProductDeliveredUnits> {
  return runInTenant(tenantId, async () => {
    const window = {
      OR: [
        { deliveryDate: { gte: from, lt: to } },
        { deliveryDate: null, updatedAt: { gte: from, lt: to } },
      ],
    };
    const order: Prisma.OrderWhereInput = {
      tenantId,
      deletedAt: null,
      ...window,
      AND: [{
        OR: [
          { status: 'delivered' },
          { status: 'digital_delivered', paymentStatus: 'paid', totalAmount: { gt: 0 } },
        ],
      }],
    };
    const where: Prisma.OrderItemWhereInput = {
      order,
      ...(productId === 'all' ? {} : { productId }),
      // free bundled digital item
      NOT: { totalPrice: 0, product: { productType: 'digital' } },
    };

    const [currency, groups] = await Promise.all([
      getCurrency(),
      prisma.orderItem.groupBy({ by: ['productId'], where, _sum: { quantity: true, totalPrice: true } }),
    ]);
    const products = productId === 'all' && groups.length
      ? await prisma.product.findMany({ where: { id: { in: groups.map((g) => g.productId) } }, select: { id: true, sku: true, name: true } })
      : [];

    const totalUnits = groups.reduce((sum, g) => sum + (g._sum.quantity ?? 0), 0);
    const totalRevenue = Money.sum(groups.map((g) => Money.orZero(g._sum.totalPrice)));
    const meta = { dateBasis: 'deliveryDate' as const, formulaId: FORMULA_ID, from: from.toISOString(), to: to.toISOString(), asOf: new Date().toISOString() };

    const result: ProductDeliveredUnits = {
      units: { name: 'Delivered units', value: totalUnits, unit: 'count', ...meta },
      lineRevenue: { name: 'Delivered line revenue', value: Money.toApi(totalRevenue), unit: 'money', currency, ...meta },
    };
    if (productId === 'all') {
      const byId = new Map(products.map((p) => [p.id, p]));
      result.byProduct = groups
        .map((g) => ({
          productId: g.productId,
          sku: byId.get(g.productId)?.sku ?? '',
          name: byId.get(g.productId)?.name ?? '',
          units: g._sum.quantity ?? 0,
          lineRevenue: Money.toApi(Money.orZero(g._sum.totalPrice)),
        }))
        .sort((a, b) => b.units - a.units || a.productId - b.productId);
    }
    return result;
  });
}
