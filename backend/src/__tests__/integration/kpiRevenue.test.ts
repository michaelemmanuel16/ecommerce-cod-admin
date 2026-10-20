/**
 * M1-T16 (F-250, F-900, F-901): delivered revenue. Throwaway tenant on the test DB.
 * Ranges are in the store zone (Africa/Accra = UTC+0), so UTC instants in the data read as local times.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { makeCustomer, makeOrder } from './helpers/kpiOrders';
import { deliveredRevenue, deliveredRevenueByArea, deliveredRevenueByDay } from '../../services/kpi/revenue';
import { getStoreTimeZone, monthRange } from '../../services/kpi/dates';

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const d = (iso: string) => new Date(iso);
const oct = monthRange(2026, 10, getStoreTimeZone());
const sep = monthRange(2026, 9, getStoreTimeZone());

let tenantId: string;
let otherTenantId: string;
let customerId: number;

const revenue = async (range = oct, tid = tenantId) => {
  const r = await deliveredRevenue(tid, range.from, range.to);
  return { total: r.total.value, physical: r.physical.value, digital: r.digital.value, orders: r.deliveredOrders.value };
};

beforeAll(async () => {
  const [t, o] = await Promise.all([createTenant('Kpi Rev A'), createTenant('Kpi Rev B')]);
  tenantId = t.id;
  otherTenantId = o.id;
  customerId = (await makeCustomer(tenantId)).id;
  const otherCustomer = await makeCustomer(otherTenantId);

  // A physical set with a free bundled guide: the set price only (F-250).
  const set = await prismaBase.product.create({ data: { sku: `SET-${Date.now()}`, name: 'Copybook set', category: 'books', price: 249, stockQuantity: 10, tenantId } });
  const guide = await prismaBase.product.create({ data: { sku: `GUIDE-${Date.now()}`, name: 'Guide', category: 'ebook', price: 59, stockQuantity: 0, productType: 'digital', tenantId } });
  const bundled = await makeOrder({ tenantId, customerId, status: 'delivered', totalAmount: 249, deliveryDate: d('2026-10-05T10:00:00Z') });
  await prismaBase.orderItem.createMany({
    data: [
      { orderId: bundled.id, productId: set.id, quantity: 1, unitPrice: 249, totalPrice: 249 },
      { orderId: bundled.id, productId: guide.id, quantity: 1, unitPrice: 0, totalPrice: 0, itemType: 'bump' },
    ],
  });

  // Counts for October.
  await makeOrder({ tenantId, customerId, status: 'delivered', totalAmount: 100.5, deliveryDate: d('2026-10-17T23:59:59Z') });
  // Edges that must not count.
  await makeOrder({ tenantId, customerId, status: 'delivered', totalAmount: 1000, deliveryDate: d('2026-11-01T00:00:00.000Z') });
  await makeOrder({ tenantId, customerId, status: 'delivered', totalAmount: 7, deliveryDate: d('2026-09-30T23:59:59.999Z') });
  await makeOrder({ tenantId, customerId, status: 'cancelled', totalAmount: 500, deliveryDate: null, createdAt: d('2026-10-05T10:00:00Z') });
  await makeOrder({ tenantId, customerId, status: 'failed_delivery', totalAmount: 500 });
  await makeOrder({ tenantId, customerId, status: 'pending_confirmation', totalAmount: 500 });
  // Failed first, then returned: never delivered, no delivered history row.
  await makeOrder({ tenantId, customerId, status: 'returned', totalAmount: 300, returnedAt: d('2026-10-09T10:00:00Z'), history: [{ status: 'failed_delivery', at: d('2026-10-07T10:00:00Z') }] });
  // Delivered and returned in the same month: adds 0.
  await makeOrder({ tenantId, customerId, status: 'returned', totalAmount: 400, returnedAt: d('2026-10-12T10:00:00Z'), history: [{ status: 'delivered', at: d('2026-10-08T10:00:00Z') }] });
  // Delivered in September, returned in October: September keeps it, October loses it (F-900).
  await makeOrder({ tenantId, customerId, status: 'returned', totalAmount: 249, returnedAt: d('2026-10-04T10:00:00Z'), history: [{ status: 'delivered', at: d('2026-09-20T10:00:00Z') }] });
  // Digital: paid counts, free bundle and unpaid do not.
  await makeOrder({ tenantId, customerId, status: 'digital_delivered', paymentStatus: 'paid', totalAmount: 59, deliveryDate: d('2026-10-06T10:00:00Z') });
  await makeOrder({ tenantId, customerId, status: 'digital_delivered', paymentStatus: 'paid', totalAmount: 0, deliveryDate: d('2026-10-06T10:00:00Z') });
  await makeOrder({ tenantId, customerId, status: 'payment_pending', paymentStatus: 'pending', totalAmount: 59 });
  await makeOrder({ tenantId, customerId, status: 'digital_delivered', paymentStatus: 'pending', totalAmount: 59, deliveryDate: d('2026-10-06T10:00:00Z') });
  // Old row: delivered with no deliveryDate falls back to updatedAt (F-900 edge case).
  await makeOrder({ tenantId, customerId, status: 'delivered', totalAmount: 11, deliveryDate: null, updatedAt: d('2026-10-10T10:00:00Z') });

  // Another tenant's order must never reach this tenant.
  await makeOrder({ tenantId: otherTenantId, customerId: otherCustomer.id, status: 'delivered', totalAmount: 99999, deliveryDate: d('2026-10-05T10:00:00Z') });
});

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('deliveredRevenue (F-250, F-900, F-901)', () => {
  it('October: set price only for the bundled guide, delivered + paid digital, return month rule, no cancelled/failed/open', async () => {
    // physical: 249 (set + free guide) + 100.50 + 11 (updatedAt fallback) + 0 (same-month return) - 249 (Sep delivery returned in Oct)
    // digital: 59 (paid) only
    const r = await revenue();
    expect(r.physical).toBe('111.50');
    expect(r.digital).toBe('59.00');
    expect(r.total).toBe('170.50');
    // orders: 3 delivered, the same-month return (+1 -1), the September delivery returned in October (-1), 1 paid digital
    expect(r.orders).toBe(3);
  });

  it('September keeps the order that was returned in October as booked (no restatement of a closed month)', async () => {
    const r = await revenue(sep);
    expect(r.physical).toBe('256.00'); // 7 (30 Sep 23:59:59.999) + 249 (booked 20 Sep)
    expect(r.digital).toBe('0.00');
  });

  it('range edges: [from, to) excludes the instant `to` and includes the last millisecond before it', async () => {
    const r = await deliveredRevenue(tenantId, d('2026-10-17T23:59:59Z'), d('2026-10-18T00:00:00Z'));
    expect(r.physical.value).toBe('100.50');
    const none = await deliveredRevenue(tenantId, d('2026-10-17T00:00:00Z'), d('2026-10-17T23:59:59Z'));
    expect(none.physical.value).toBe('0.00');
  });

  it('a range with no orders returns 0.00, not an error', async () => {
    const r = await revenue({ from: d('2025-01-01T00:00:00Z'), to: d('2025-02-01T00:00:00Z') });
    expect(r).toEqual({ total: '0.00', physical: '0.00', digital: '0.00', orders: 0 });
  });

  it('every part is a KpiResult with the delivery-date basis and the store currency on money', async () => {
    const r = await deliveredRevenue(tenantId, oct.from, oct.to);
    for (const part of [r.physical, r.digital, r.total]) {
      expect(part).toMatchObject({ unit: 'money', dateBasis: 'deliveryDate', formulaId: 'revenue.delivered.v1', currency: 'GHS', from: oct.from.toISOString(), to: oct.to.toISOString() });
      expect(typeof part.value).toBe('string');
    }
    expect(r.deliveredOrders.unit).toBe('count');
    expect(Number.isNaN(Date.parse(r.total.asOf))).toBe(false);
  });

  it('is scoped to the tenant', async () => {
    const other = await revenue(oct, otherTenantId);
    expect(other.total).toBe('99999.00');
    expect((await revenue()).total).not.toBe('99999.00');
  });
});

describe('deliveredRevenueByDay and deliveredRevenueByArea (same rules, one grouped query)', () => {
  it('October by store-zone day: deliveries add on their day, a return subtracts on the return day', async () => {
    const days = await deliveredRevenueByDay(tenantId, oct.from, oct.to);
    expect(days).toEqual([
      { date: '2026-10-04', revenue: '-249.00', deliveredOrders: -1 }, // September delivery returned
      { date: '2026-10-05', revenue: '249.00', deliveredOrders: 1 },
      { date: '2026-10-06', revenue: '59.00', deliveredOrders: 1 }, // paid digital
      { date: '2026-10-08', revenue: '400.00', deliveredOrders: 1 }, // booked, returned on the 12th
      { date: '2026-10-10', revenue: '11.00', deliveredOrders: 1 }, // updatedAt fallback
      { date: '2026-10-12', revenue: '-400.00', deliveredOrders: -1 },
      { date: '2026-10-17', revenue: '100.50', deliveredOrders: 1 },
    ]);
  });

  it('the days and the areas add up to deliveredRevenue for the same range', async () => {
    const total = await deliveredRevenue(tenantId, oct.from, oct.to);
    const days = await deliveredRevenueByDay(tenantId, oct.from, oct.to);
    const areas = await deliveredRevenueByArea(tenantId, oct.from, oct.to);
    expect(days.reduce((s, x) => s + Number(x.revenue), 0).toFixed(2)).toBe(total.total.value);
    expect(days.reduce((s, x) => s + x.deliveredOrders, 0)).toBe(total.deliveredOrders.value);
    expect(areas).toEqual([{ area: 'Accra', revenue: total.total.value, deliveredOrders: total.deliveredOrders.value }]);
  });

  it('September keeps the order returned in October on its booked day', async () => {
    const days = await deliveredRevenueByDay(tenantId, sep.from, sep.to);
    expect(days).toEqual([
      { date: '2026-09-20', revenue: '249.00', deliveredOrders: 1 },
      { date: '2026-09-30', revenue: '7.00', deliveredOrders: 1 },
    ]);
  });

  it('is scoped to the tenant and to a rep or partner', async () => {
    expect(await deliveredRevenueByDay(tenantId, oct.from, oct.to, { customerRepId: 999999 })).toEqual([]);
    expect(await deliveredRevenueByArea(tenantId, oct.from, oct.to, { deliveryAgentId: 999999 })).toEqual([]);
    expect(await deliveredRevenueByDay(otherTenantId, oct.from, oct.to)).toEqual([
      { date: '2026-10-05', revenue: '99999.00', deliveredOrders: 1 },
    ]);
  });
});
