/**
 * M1-T20 (F-610): product delivered units. Throwaway tenant on the test DB; the fixture numbers are in
 * fixtureChecks/products.ts. Store zone Africa/Accra = UTC+0.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { makeCustomer, makeOrder } from './helpers/kpiOrders';
import { productDeliveredUnits } from '../../services/kpi/products';
import { getStoreTimeZone, monthRange } from '../../services/kpi/dates';

const d = (iso: string) => new Date(iso);
const oct = monthRange(2026, 10, getStoreTimeZone());

let tenantId: string;
let otherTenantId: string;
let setId: number;
let penId: number;
let guideId: number;

const line = (orderId: number, productId: number, quantity: number, unitPrice: number, extra: { itemType?: string } = {}) =>
  prismaBase.orderItem.create({ data: { orderId, productId, quantity, unitPrice, totalPrice: unitPrice * quantity, ...extra } });

beforeAll(async () => {
  const [t, o] = await Promise.all([createTenant('Kpi Prod A'), createTenant('Kpi Prod B')]);
  tenantId = t.id;
  otherTenantId = o.id;
  const customerId = (await makeCustomer(tenantId)).id;
  const otherCustomerId = (await makeCustomer(otherTenantId)).id;
  const sku = `${Date.now()}`;
  const product = (tid: string, name: string, price: number, extra: { productType?: string } = {}) =>
    prismaBase.product.create({ data: { sku: `${name}-${sku}`, name, category: 'x', price, stockQuantity: 10, tenantId: tid, ...extra } });
  const [set, pen, guide, otherSet] = await Promise.all([
    product(tenantId, 'set', 249), product(tenantId, 'pen', 40), product(tenantId, 'guide', 59, { productType: 'digital' }), product(otherTenantId, 'set', 249),
  ]);
  setId = set.id; penId = pen.id; guideId = guide.id;

  // Counts: 2 sets + 1 pen, with a free bundled guide (does not count).
  const a = await makeOrder({ tenantId, customerId, status: 'delivered', totalAmount: 538, deliveryDate: d('2026-10-05T10:00:00Z') });
  await line(a.id, setId, 2, 249); await line(a.id, penId, 1, 40); await line(a.id, guideId, 1, 0, { itemType: 'bump' });
  // Counts: 1 set at 249 on the last instant of October.
  const b = await makeOrder({ tenantId, customerId, status: 'delivered', totalAmount: 249, deliveryDate: d('2026-10-31T23:59:59.999Z') });
  await line(b.id, setId, 1, 249);
  // Paid digital order: the guide counts; unpaid or free does not.
  const paid = await makeOrder({ tenantId, customerId, status: 'digital_delivered', paymentStatus: 'paid', totalAmount: 59, deliveryDate: d('2026-10-06T10:00:00Z') });
  await line(paid.id, guideId, 1, 59);
  const unpaid = await makeOrder({ tenantId, customerId, status: 'digital_delivered', paymentStatus: 'pending', totalAmount: 59, deliveryDate: d('2026-10-06T10:00:00Z') });
  await line(unpaid.id, guideId, 1, 59);
  // Old row, no deliveryDate: updatedAt decides.
  const old = await makeOrder({ tenantId, customerId, status: 'delivered', totalAmount: 40, deliveryDate: null, updatedAt: d('2026-10-10T10:00:00Z') });
  await line(old.id, penId, 3, 40);
  // Never count: out of range, returned (even delivered in October first), cancelled, failed, open.
  const sep = await makeOrder({ tenantId, customerId, status: 'delivered', totalAmount: 249, deliveryDate: d('2026-09-30T23:59:59Z') });
  await line(sep.id, setId, 1, 249);
  const nov = await makeOrder({ tenantId, customerId, status: 'delivered', totalAmount: 249, deliveryDate: d('2026-11-01T00:00:00Z') });
  await line(nov.id, setId, 1, 249);
  const returned = await makeOrder({ tenantId, customerId, status: 'returned', totalAmount: 249, returnedAt: d('2026-10-12T10:00:00Z'), history: [{ status: 'delivered', at: d('2026-10-08T10:00:00Z') }] });
  await line(returned.id, setId, 5, 249);
  for (const status of ['cancelled', 'failed_delivery', 'pending_confirmation', 'out_for_delivery'] as const) {
    const o2 = await makeOrder({ tenantId, customerId, status, totalAmount: 249, deliveryDate: d('2026-10-07T10:00:00Z') });
    await line(o2.id, setId, 7, 249);
  }
  // Another tenant's order with the same shape.
  const x = await makeOrder({ tenantId: otherTenantId, customerId: otherCustomerId, status: 'delivered', totalAmount: 249, deliveryDate: d('2026-10-05T10:00:00Z') });
  await line(x.id, otherSet.id, 100, 249);
});

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.product.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } });
  await prismaBase.$disconnect();
});

describe('productDeliveredUnits (F-610)', () => {
  it('all products: delivered and paid digital by deliveryDate; no returned, cancelled, failed, open, free bundle or other tenant', async () => {
    const r = await productDeliveredUnits(tenantId, 'all', oct.from, oct.to);
    const by = Object.fromEntries((r.byProduct ?? []).map((p) => [p.name, [p.units, p.lineRevenue]]));
    expect(by).toEqual({ set: [3, '747.00'], pen: [4, '160.00'], guide: [1, '59.00'] });
    expect(r.units.value).toBe(8);
    expect(r.lineRevenue.value).toBe('966.00');
    expect(r.units).toMatchObject({ unit: 'count', dateBasis: 'deliveryDate', formulaId: 'products.deliveredUnits.v1' });
  });

  it('one product: same number as its row; most units first in the list', async () => {
    expect((await productDeliveredUnits(tenantId, setId, oct.from, oct.to)).units.value).toBe(3);
    expect((await productDeliveredUnits(tenantId, penId, oct.from, oct.to)).units.value).toBe(4);
    expect((await productDeliveredUnits(tenantId, guideId, oct.from, oct.to)).units.value).toBe(1);
    expect((await productDeliveredUnits(tenantId, setId, oct.from, oct.to)).byProduct).toBeUndefined();
    const all = await productDeliveredUnits(tenantId, 'all', oct.from, oct.to);
    expect(all.byProduct?.map((p) => p.name)).toEqual(['pen', 'set', 'guide']); // 4, 3, 1 units
  });

  it('a range with no delivery returns 0 and an empty list', async () => {
    const r = await productDeliveredUnits(tenantId, 'all', d('2026-08-01T00:00:00Z'), d('2026-09-01T00:00:00Z'));
    expect(r.units.value).toBe(0);
    expect(r.lineRevenue.value).toBe('0.00');
    expect(r.byProduct).toEqual([]);
  });

  it('range is [from, to): September 30 is September, not October', async () => {
    const sep = monthRange(2026, 9, getStoreTimeZone());
    expect((await productDeliveredUnits(tenantId, setId, sep.from, sep.to)).units.value).toBe(1);
  });

  it('a product of another tenant is invisible', async () => {
    const other = await prismaBase.product.findFirstOrThrow({ where: { tenantId: otherTenantId } });
    expect((await productDeliveredUnits(tenantId, other.id, oct.from, oct.to)).units.value).toBe(0);
  });
});
