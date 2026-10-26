/**
 * M4-T07 / M4-T08 (F-657, F-305): stock leaves once per order, at `delivered`, from the holder at that moment.
 * One throwaway tenant. Orders come from the public checkout service, so the whole path runs: creation, dispatch, delivery.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { cacheOf, levelAt, stockUp } from './helpers/stock';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import orderService from '../../services/orderService';
import publicOrderService from '../../services/publicOrderService';
import deliveryService from '../../services/deliveryService';
import { transitionOrder } from '../../services/orderStateMachine';
import { fulfilOrder } from '../../services/stockService';
import prisma from '../../utils/prisma';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

jest.setTimeout(120_000);

const SUFFIX = Date.now();
let tenantId: string;
let productId: number;
let upsellProductId: number;
let digitalProductId: number;
let formSlug: string;
let formId: number;
let kofi: { userId: number; locationId: number };
let ama: { userId: number; locationId: number };
let threeSet: number;
let twoUnit: number;
let upsellId: number;
let phone = 0;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
const status = async (id: number, to: any) => inTenant(() => orderService.updateOrderStatus(id, { status: to }));
const fulfilments = (orderId: number, extra: Record<string, unknown> = {}) =>
  prismaBase.inventoryTransfer.findMany({ where: { orderId, transferType: 'order_fulfillment', ...extra }, orderBy: { id: 'asc' } });
const cache = (id = productId) => cacheOf(id);

const partner = async (label: string) => {
  const user = await prismaBase.user.create({
    data: { email: `so-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'Agent', role: 'delivery_agent', tenantId },
  });
  const locationId = await stockUp(tenantId, productId, 0, { name: `${label} Agent`, type: 'agent', userId: user.id });
  return { userId: user.id, locationId };
};

/** A public order for the package, with the agent set and confirmed. */
async function publicOrder(packageId: number, agentUserId: number | null, upsells: number[] = []) {
  phone += 1;
  const created = await inTenant(() => publicOrderService.createPublicOrder(formSlug, {
    firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+23355${String(SUFFIX).slice(-6)}${phone}`,
    deliveryAddress: '5 Test Rd', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
    selectedPackageId: packageId, selectedUpsellIds: upsells,
  }));
  if (agentUserId != null) await prismaBase.order.update({ where: { id: created.orderId }, data: { deliveryAgentId: agentUserId } });
  return created.orderId;
}

beforeAll(async () => {
  const tenant = await createTenant('Stock Once');
  tenantId = tenant.id;
  await seedTenantDefaults(tenantId);
  const product = (sku: string, extra: Record<string, unknown> = {}) =>
    prismaBase.product.create({ data: { sku: `SO-${sku}-${SUFFIX}`, name: sku, category: 'test', price: 100, cogs: 20, stockQuantity: 0, tenantId, ...extra } }).then((p) => p.id);
  productId = await product('Copybook');
  upsellProductId = await product('Pens');
  digitalProductId = await product('Guide', { productType: 'digital' });
  kofi = await partner('Kofi');
  ama = await partner('Ama');
  await stockUp(tenantId, productId, 100, { locationId: kofi.locationId });
  await stockUp(tenantId, productId, 100, { locationId: ama.locationId });
  await stockUp(tenantId, upsellProductId, 50, { locationId: kofi.locationId });

  formSlug = `so-form-${SUFFIX}`;
  const form = await prismaBase.checkoutForm.create({ data: { name: 'SO Form', slug: formSlug, productId, fields: {}, styling: {}, regions: [], tenantId } });
  formId = form.id;
  threeSet = (await prismaBase.formPackage.create({ data: { formId, name: '3 sets', price: 300, quantity: 3 } })).id;
  twoUnit = (await prismaBase.formPackage.create({ data: { formId, name: '2 units', price: 200, quantity: 2 } })).id;
  upsellId = (await prismaBase.formUpsell.create({ data: { formId, name: 'Pens add-on', price: 30, items: [], productId: upsellProductId } as any })).id;
}, 60_000);

afterAll(async () => {
  await prismaBase.formSubmission.deleteMany({ where: { formId } });
  await prismaBase.formUpsell.deleteMany({ where: { formId } });
  await prismaBase.formPackage.deleteMany({ where: { formId } });
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('stock leaves once per order (F-657)', () => {
  it('deliver, return, re-deliver ends at -3 from the 3 the order took the first time round', async () => {
    const start = await levelAt(kofi.locationId, productId);
    const id = await publicOrder(threeSet, kofi.userId);
    expect(await levelAt(kofi.locationId, productId)).toBe(start); // creation moves nothing
    await status(id, 'confirmed');
    await status(id, 'out_for_delivery');
    expect(await levelAt(kofi.locationId, productId)).toBe(start); // dispatch moves nothing
    await status(id, 'delivered');
    expect(await levelAt(kofi.locationId, productId)).toBe(start - 3);
    await status(id, 'returned');
    expect(await levelAt(kofi.locationId, productId)).toBe(start);
    // A returned order is final in the table; an integration feed (3PL says delivered) may revive it.
    await inTenant(() => transitionOrder(id, 'delivered', { kind: 'integration' }));
    expect(await levelAt(kofi.locationId, productId)).toBe(start - 3);
    const all = await fulfilments(id);
    expect(all).toHaveLength(2);
    expect(all.map((r) => [r.quantity, r.reversedAt != null])).toEqual([[3, true], [3, false]]);
    const reversals = await prismaBase.inventoryTransfer.findMany({ where: { orderId: id, transferType: 'order_reversal' } });
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ quantity: 3, toLocationId: kofi.locationId });
    expect(await cache()).toBe(await levelAt(kofi.locationId, productId) + await levelAt(ama.locationId, productId));
  });

  it('a repeated delivered call adds nothing', async () => {
    const start = await levelAt(kofi.locationId, productId);
    const id = await publicOrder(twoUnit, kofi.userId);
    await status(id, 'confirmed');
    await status(id, 'out_for_delivery');
    await status(id, 'delivered');
    await status(id, 'delivered');
    await inTenant(() => transitionOrder(id, 'delivered', { kind: 'integration' }));
    expect(await levelAt(kofi.locationId, productId)).toBe(start - 2);
    expect(await fulfilments(id)).toHaveLength(1);
    // Even when fulfilOrder itself is called again, the line has an active movement and is skipped.
    await inTenant(() => prisma.$transaction((tx) => fulfilOrder(tx, { id, deliveryAgentId: kofi.userId })));
    expect(await levelAt(kofi.locationId, productId)).toBe(start - 2);
    expect(await fulfilments(id)).toHaveLength(1);
  });

  it('cancelling a pending public order changes nothing', async () => {
    const start = await levelAt(kofi.locationId, productId);
    const startCache = await cache();
    const id = await publicOrder(threeSet, kofi.userId);
    await status(id, 'cancelled');
    expect(await levelAt(kofi.locationId, productId)).toBe(start);
    expect(await cache()).toBe(startCache);
    expect(await prismaBase.inventoryTransfer.count({ where: { orderId: id } })).toBe(0);
  });

  it('a failed delivery and a cancel after dispatch move nothing', async () => {
    const start = await levelAt(kofi.locationId, productId);
    const id = await publicOrder(twoUnit, kofi.userId);
    await status(id, 'confirmed');
    await status(id, 'out_for_delivery');
    await inTenant(() => transitionOrder(id, 'failed_delivery', { kind: 'system' }, { failureReason: 'refused' }));
    await inTenant(() => transitionOrder(id, 'cancelled', { kind: 'system' }));
    expect(await levelAt(kofi.locationId, productId)).toBe(start);
    expect(await prismaBase.inventoryTransfer.count({ where: { orderId: id } })).toBe(0);
  });

  it('upsell lines move stock once each, at delivery, and reverse with the order', async () => {
    const [startMain, startUpsell] = [await levelAt(kofi.locationId, productId), await levelAt(kofi.locationId, upsellProductId)];
    const id = await publicOrder(threeSet, kofi.userId, [upsellId]);
    expect([await levelAt(kofi.locationId, productId), await levelAt(kofi.locationId, upsellProductId)]).toEqual([startMain, startUpsell]);
    await status(id, 'confirmed');
    await status(id, 'out_for_delivery');
    await status(id, 'delivered');
    expect([await levelAt(kofi.locationId, productId), await levelAt(kofi.locationId, upsellProductId)]).toEqual([startMain - 3, startUpsell - 1]);
    const rows = await fulfilments(id);
    expect(rows.map((r) => [r.productId, r.quantity])).toEqual([[productId, 3], [upsellProductId, 1]]);
    expect(new Set(rows.map((r) => r.itemKey)).size).toBe(2);
    await status(id, 'returned');
    expect([await levelAt(kofi.locationId, productId), await levelAt(kofi.locationId, upsellProductId)]).toEqual([startMain, startUpsell]);
  });

  it('the holder at delivery time is used when the partner changes after dispatch', async () => {
    const [kofiStart, amaStart] = [await levelAt(kofi.locationId, productId), await levelAt(ama.locationId, productId)];
    const id = await publicOrder(twoUnit, kofi.userId);
    await status(id, 'confirmed');
    await status(id, 'out_for_delivery');
    await prismaBase.order.update({ where: { id }, data: { deliveryAgentId: ama.userId } });
    await status(id, 'delivered');
    expect(await levelAt(kofi.locationId, productId)).toBe(kofiStart);
    expect(await levelAt(ama.locationId, productId)).toBe(amaStart - 2);
    expect((await fulfilments(id))[0].fromLocationId).toBe(ama.locationId);
    await status(id, 'returned'); // the units go back to where they came from
    expect(await levelAt(ama.locationId, productId)).toBe(amaStart);
  });

  it('two parallel delivered calls: one wins, the units leave once', async () => {
    const start = await levelAt(kofi.locationId, productId);
    const id = await publicOrder(threeSet, kofi.userId);
    await status(id, 'confirmed');
    await status(id, 'out_for_delivery');
    const results = await Promise.allSettled([status(id, 'delivered'), status(id, 'delivered')]);
    expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'STALE_ORDER' });
    expect(await fulfilments(id)).toHaveLength(1);
    expect(await levelAt(kofi.locationId, productId)).toBe(start - 3);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).status).toBe('delivered');
  });

  it('no partner: delivered is refused with "Assign a delivery partner first", forced or by a feed, and the order does not move', async () => {
    const id = await publicOrder(twoUnit, null);
    await status(id, 'confirmed');
    await expect(inTenant(() => transitionOrder(id, 'delivered', { kind: 'integration' })))
      .rejects.toMatchObject({ message: 'Assign a delivery partner first' });
    const admin = await prismaBase.user.create({ data: { email: `so-admin-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Boss', lastName: 'Owner', role: 'super_admin', tenantId } });
    await expect(inTenant(() => transitionOrder(id, 'delivered', { kind: 'user', userId: admin.id, role: 'super_admin' }, { force: true })))
      .rejects.toMatchObject({ message: 'Assign a delivery partner first' });
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id } })).status).toBe('confirmed');
    expect(await prismaBase.inventoryTransfer.count({ where: { orderId: id } })).toBe(0);
  });

  it('not enough units: the delivery completes, on-hand goes negative and one stock_gap Finding opens', async () => {
    const poor = await partner('Esi');
    await stockUp(tenantId, productId, 1, { locationId: poor.locationId });
    const first = await publicOrder(threeSet, poor.userId);
    await status(first, 'confirmed');
    await status(first, 'out_for_delivery');
    await status(first, 'delivered');
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: first } })).status).toBe('delivered');
    expect(await levelAt(poor.locationId, productId)).toBe(-2);
    const subject = `${poor.locationId}:${productId}`;
    const findings = () => prismaBase.finding.findMany({ where: { tenantId, type: 'stock_gap', subjectType: 'stock_level', subjectId: subject } });
    expect(await findings()).toHaveLength(1);
    expect(Number((await findings())[0].amount)).toBe(40); // 2 missing units at cost 20
    expect((await findings())[0].note).toContain('-2');
    // A second delivery at the same holder and product updates the one open Finding, it does not add another.
    const second = await publicOrder(twoUnit, poor.userId);
    await status(second, 'confirmed');
    await status(second, 'out_for_delivery');
    await status(second, 'delivered');
    expect(await levelAt(poor.locationId, productId)).toBe(-4);
    expect(await findings()).toHaveLength(1);
    expect(Number((await findings())[0].amount)).toBe(80);
  });

  it('a partner with no stock location gets one, so the delivery is not blocked', async () => {
    const bare = await prismaBase.user.create({ data: { email: `so-bare-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Bare', lastName: 'Agent', role: 'delivery_agent', tenantId } });
    const id = await publicOrder(twoUnit, bare.id);
    await status(id, 'confirmed');
    await status(id, 'out_for_delivery');
    await status(id, 'delivered');
    const location = await prismaBase.stockLocation.findFirstOrThrow({ where: { tenantId, userId: bare.id } });
    expect(location).toMatchObject({ type: 'agent', name: 'Bare Agent' });
    expect(await levelAt(location.id, productId)).toBe(-2);
  });

  it('a digital line moves no stock and needs no partner', async () => {
    const customer = await prismaBase.customer.create({
      data: { firstName: 'Dig', lastName: 'Buyer', phoneNumber: `+2332${String(SUFFIX).slice(-8)}9`, address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId },
    });
    const order = await prismaBase.order.create({
      data: {
        customerId: customer.id, status: 'out_for_delivery', subtotal: 10, totalAmount: 10, codAmount: 10, tenantId,
        deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
        orderItems: { create: [{ productId: digitalProductId, quantity: 1, unitPrice: 10, totalPrice: 10 }] },
      } as any,
    });
    await status(order.id, 'delivered');
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('delivered');
    expect(await prismaBase.inventoryTransfer.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('deliveryService.completeDelivery goes through the machine: the units leave once', async () => {
    const start = await levelAt(kofi.locationId, productId);
    const id = await publicOrder(twoUnit, kofi.userId);
    await status(id, 'confirmed');
    await status(id, 'out_for_delivery');
    const delivery = await prismaBase.delivery.create({
      data: { orderId: id, agentId: kofi.userId, tenantId, scheduledTime: new Date() },
    });
    await inTenant(() => deliveryService.completeDelivery(String(delivery.id), { proofType: 'signature', proofData: 'x', recipientName: 'Ama' } as any, String(kofi.userId)));
    expect(await levelAt(kofi.locationId, productId)).toBe(start - 2);
    expect(await fulfilments(id)).toHaveLength(1);
    await status(id, 'delivered');
    expect(await levelAt(kofi.locationId, productId)).toBe(start - 2);
  });
});
