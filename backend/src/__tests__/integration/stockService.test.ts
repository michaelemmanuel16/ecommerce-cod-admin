/**
 * M4-T06 (F-651): stockService core. Movement types, the Product.stockQuantity cache, rollback, reserved and
 * available arithmetic, rebuildCache and a concurrent pair. One throwaway tenant and one other tenant on the test DB.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import * as stock from '../../services/stockService';
import { cacheOf, levelAt } from './helpers/stock';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
let tenantId: string;
let otherTenantId: string;
let adminId: number;
let agentUserId: number;
let threePlUserId: number;
let customerId: number;
let copybook: number;
let pens: number;
let ebook: number;
let store: number;
let threePl: number;
let agent: number;
let transit: number;
let otherLocation: number;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
const level = levelAt;
const cache = cacheOf;
const move = (input: Omit<stock.MovementInput, 'createdById'>) =>
  inTenant(() => prisma.$transaction((tx) => stock.applyMovement(tx, { createdById: adminId, ...input }))).then((r) => r.row);

beforeAll(async () => {
  tenantId = (await createTenant('Stock Service')).id;
  otherTenantId = (await createTenant('Stock Service Other')).id;
  const user = (label: string, role: any, extra: Record<string, unknown> = {}) =>
    prismaBase.user.create({ data: { email: `ss-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'S', role, tenantId, ...extra } });
  adminId = (await user('admin', 'admin')).id;
  agentUserId = (await user('kofi', 'delivery_agent')).id;
  threePlUserId = (await user('swift', 'delivery_agent', { kind: 'company' })).id;
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${String(SUFFIX).slice(-8)}`, address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId },
  })).id;
  const product = (sku: string, extra: Record<string, unknown> = {}) =>
    prismaBase.product.create({ data: { sku: `SS-${sku}-${SUFFIX}`, name: sku, category: 'x', price: 50, cogs: 10, stockQuantity: 0, tenantId, ...extra } }).then((p) => p.id);
  copybook = await product('Copybook');
  pens = await product('Pens');
  ebook = await product('Ebook', { productType: 'digital' });
  const location = (name: string, type: any, userId?: number) =>
    prismaBase.stockLocation.create({ data: { tenantId, name, type, userId } }).then((l) => l.id);
  store = await location('Own store', 'own_store');
  threePl = await location('Swift', 'partner_3pl', threePlUserId);
  agent = await location('Kofi', 'agent', agentUserId);
  transit = await location('In transit', 'in_transit');
  otherLocation = (await prismaBase.stockLocation.create({ data: { tenantId: otherTenantId, name: 'Other store', type: 'own_store' } })).id;
}, 60_000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('applyMovement: one row and the level change together', () => {
  it('opening: raises the destination, writes a received row, updates the cache', async () => {
    const row = await move({ type: 'opening', productId: copybook, quantity: 100, toLocationId: threePl });
    expect(row).toMatchObject({ transferType: 'opening', quantity: 100, fromLocationId: null, toLocationId: threePl, status: 'received', tenantId });
    expect(await level(threePl, copybook)).toBe(100);
    expect(await cache(copybook)).toBe(100);
  });

  it('receipt: raises the destination', async () => {
    await move({ type: 'receipt', productId: copybook, quantity: 20, toLocationId: threePl });
    expect(await level(threePl, copybook)).toBe(120);
    expect(await cache(copybook)).toBe(120);
  });

  it('allocation in transit: lowers the source at once, no destination level, cache drops', async () => {
    const row = await move({ type: 'allocation', productId: copybook, quantity: 20, fromLocationId: threePl, toLocationId: agent, status: 'in_transit' });
    expect(row.status).toBe('in_transit');
    expect(await level(threePl, copybook)).toBe(100);
    expect(await level(agent, copybook)).toBe(0);
    expect(await cache(copybook)).toBe(100);
  });

  it('agent_transfer, return_to_warehouse: one source down, one destination up', async () => {
    await move({ type: 'agent_transfer', productId: copybook, quantity: 10, fromLocationId: threePl, toLocationId: agent });
    expect(await level(agent, copybook)).toBe(10);
    await move({ type: 'return_to_warehouse', productId: copybook, quantity: 4, fromLocationId: agent, toLocationId: store });
    expect([await level(agent, copybook), await level(store, copybook), await level(threePl, copybook)]).toEqual([6, 4, 90]);
    expect(await cache(copybook)).toBe(100);
  });

  it('adjustment and count_adjustment lower one location', async () => {
    await move({ type: 'adjustment', productId: copybook, quantity: 2, fromLocationId: store, reason: 'damaged' });
    await move({ type: 'count_adjustment', productId: copybook, quantity: 12, fromLocationId: threePl, reason: 'short_on_arrival' });
    expect([await level(store, copybook), await level(threePl, copybook)]).toEqual([2, 78]);
    expect(await cache(copybook)).toBe(86);
  });

  it('order_fulfillment may take a level below zero; order_reversal puts it back', async () => {
    const fulfil = await move({ type: 'order_fulfillment', productId: copybook, quantity: 10, fromLocationId: agent, itemKey: '1', orderId: null });
    expect(await level(agent, copybook)).toBe(-4);
    expect(await cache(copybook)).toBe(76);
    await move({ type: 'order_reversal', productId: copybook, quantity: 10, toLocationId: agent, itemKey: '1' });
    expect(await level(agent, copybook)).toBe(6);
    expect(fulfil.itemKey).toBe('1');
  });

  it('the cache leaves out an inactive location and the in-transit location', async () => {
    await prismaBase.stockLocation.update({ where: { id: store }, data: { isActive: false } });
    await move({ type: 'opening', productId: pens, quantity: 7, toLocationId: store });
    expect(await level(store, pens)).toBe(7);
    expect(await cache(pens)).toBe(0);
    await prismaBase.stockLocation.update({ where: { id: store }, data: { isActive: true } });
    await move({ type: 'opening', productId: pens, quantity: 5, toLocationId: transit });
    expect(await cache(pens)).toBe(7);
    await inTenant(() => prisma.$transaction((tx) => stock.rebuildCache(tx, [pens])));
    expect(await cache(pens)).toBe(7);
  });

  it('refuses a digital product, a bad quantity, a movement with no level to change and a location of another tenant', async () => {
    await expect(move({ type: 'opening', productId: ebook, quantity: 1, toLocationId: store })).rejects.toThrow(/digital/);
    await expect(move({ type: 'opening', productId: copybook, quantity: 0, toLocationId: store })).rejects.toThrow(/above 0/);
    await expect(move({ type: 'opening', productId: copybook, quantity: 1.5, toLocationId: store })).rejects.toThrow(/above 0/);
    await expect(move({ type: 'opening', productId: copybook, quantity: 1 })).rejects.toThrow(/location/);
    await expect(move({ type: 'opening', productId: copybook, quantity: 1, toLocationId: otherLocation })).rejects.toMatchObject({ statusCode: 404 });
    expect(await level(otherLocation, copybook)).toBe(0);
  });

  it('requireOnHand refuses a movement larger than the source holds, with the number', async () => {
    const before = await level(store, copybook);
    await expect(move({ type: 'agent_transfer', productId: copybook, quantity: before + 1, fromLocationId: store, toLocationId: agent, requireOnHand: true }))
      .rejects.toMatchObject({ statusCode: 400, message: `Only ${before} available at Own store` });
    expect(await level(store, copybook)).toBe(before);
  });
});

describe('transaction rollback', () => {
  it('a failure after the level change rolls back the movement, the level and the cache', async () => {
    const [levelBefore, cacheBefore, rowsBefore] = [await level(threePl, copybook), await cache(copybook), await prismaBase.inventoryTransfer.count({ where: { tenantId } })];
    await expect(inTenant(() => prisma.$transaction(async (tx) => {
      await stock.applyMovement(tx, { type: 'adjustment', productId: copybook, quantity: 5, fromLocationId: threePl, createdById: adminId });
      throw new Error('later step failed');
    }))).rejects.toThrow('later step failed');
    expect([await level(threePl, copybook), await cache(copybook), await prismaBase.inventoryTransfer.count({ where: { tenantId } })])
      .toEqual([levelBefore, cacheBefore, rowsBefore]);
  });

  it('a movement that fails midway leaves nothing behind', async () => {
    const [levelBefore, rowsBefore] = [await level(threePl, copybook), await prismaBase.inventoryTransfer.count({ where: { tenantId } })];
    // The destination is another tenant's location: the source level is changed first, then the lookup fails.
    await expect(move({ type: 'agent_transfer', productId: copybook, quantity: 1, fromLocationId: threePl, toLocationId: otherLocation })).rejects.toThrow();
    expect([await level(threePl, copybook), await prismaBase.inventoryTransfer.count({ where: { tenantId } })]).toEqual([levelBefore, rowsBefore]);
  });
});

describe('concurrent movements', () => {
  it('ten parallel debits of one level all land and the cache matches', async () => {
    await move({ type: 'opening', productId: pens, quantity: 50, toLocationId: threePl });
    const before = await level(threePl, pens);
    await Promise.all(Array.from({ length: 10 }, () => move({ type: 'adjustment', productId: pens, quantity: 3, fromLocationId: threePl })));
    expect(await level(threePl, pens)).toBe(before - 30);
    const sum = await prismaBase.stockLevel.aggregate({ _sum: { quantity: true }, where: { productId: pens, locationId: { in: [store, threePl, agent] } } });
    expect(await cache(pens)).toBe(sum._sum.quantity);
  });
});

describe('on hand, reserved and available to sell', () => {
  let product: number;
  const order = async (status: any, quantity: number, deliveryAgentId: number | null, extra: Record<string, unknown> = {}) =>
    prismaBase.order.create({
      data: {
        customerId, status, subtotal: 10, totalAmount: 10, codAmount: 10, tenantId, deliveryAgentId,
        deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra', ...extra,
        orderItems: { create: [{ productId: product, quantity, unitPrice: 10, totalPrice: 10 }] },
      } as any,
    });

  beforeAll(async () => {
    product = (await prismaBase.product.create({ data: { sku: `SS-RES-${SUFFIX}`, name: 'Reserved', category: 'x', price: 5, stockQuantity: 0, tenantId } })).id;
    await move({ type: 'opening', productId: product, quantity: 40, toLocationId: threePl });
    await move({ type: 'opening', productId: product, quantity: 10, toLocationId: agent });
    await order('confirmed', 2, threePlUserId);
    await order('preparing', 3, threePlUserId);
    await order('ready_for_pickup', 4, threePlUserId);
    await order('out_for_delivery', 5, agentUserId);
    await order('delivered', 50, agentUserId);
    await order('cancelled', 50, agentUserId);
    await order('pending_confirmation', 50, agentUserId);
    await order('out_for_delivery', 50, null);
    await order('out_for_delivery', 50, agentUserId, { deletedAt: new Date() });
  });

  it('on hand: per location and summed over the active physical locations', async () => {
    expect(await inTenant(() => stock.getOnHand(product, threePl))).toBe(40);
    expect(await inTenant(() => stock.getOnHand(product, agent))).toBe(10);
    expect(await inTenant(() => stock.getOnHand(product))).toBe(50);
  });

  it('reserved counts confirmed, preparing, ready and out-for-delivery lines at the holder only', async () => {
    expect(await inTenant(() => stock.getReserved(product, threePl))).toBe(2 + 3 + 4);
    expect(await inTenant(() => stock.getReserved(product, agent))).toBe(5);
    expect(await inTenant(() => stock.getReserved(product))).toBe(14);
    expect(await inTenant(() => stock.getReserved(product, store))).toBe(0);
  });

  it('available to sell is on hand less reserved over all holders, and may be negative', async () => {
    expect(await inTenant(() => stock.getAvailableToSell(product))).toBe(36);
    await order('confirmed', 60, agentUserId);
    expect(await inTenant(() => stock.getAvailableToSell(product))).toBe(-24);
  });
});

describe('rebuildCache', () => {
  it('sets the cache to the sum of the levels for the given products, or for all, and skips a digital product', async () => {
    await prismaBase.product.updateMany({ where: { id: { in: [copybook, pens, ebook] } }, data: { stockQuantity: 999 } });
    const some = await inTenant(() => prisma.$transaction((tx) => stock.rebuildCache(tx, [copybook])));
    expect([...some.keys()]).toEqual([copybook]);
    expect(await cache(copybook)).toBe(some.get(copybook));
    expect(await cache(pens)).toBe(999);
    const all = await inTenant(() => prisma.$transaction((tx) => stock.rebuildCache(tx)));
    expect(all.has(ebook)).toBe(false);
    expect(await cache(ebook)).toBe(999);
    const sum = await prismaBase.stockLevel.aggregate({ _sum: { quantity: true }, where: { productId: pens, location: { isActive: true, type: { not: 'in_transit' } } } });
    expect(await cache(pens)).toBe(sum._sum.quantity);
  });
});
