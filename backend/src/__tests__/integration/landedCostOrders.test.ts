/**
 * M4-T13 (F-611): landed cost on orders. An order entering `delivered` stores Order.landedCostTotal = sum of quantity x
 * Product.cogs at that moment, in the same transaction as the stock leaving; the revenue entry's COGS leg books the same
 * amount. A later cost change never moves it. Leaving `delivered` reverses the amount the entry booked and clears the field.
 * An order delivered before M4 has no stored amount (no backfill) and reverses with the amount of its own entry.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import prisma from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { stockUp } from './helpers/stock';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import orderService from '../../services/orderService';
import publicOrderService from '../../services/publicOrderService';
import { fulfilOrder } from '../../services/stockService';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

jest.setTimeout(120_000);

const SUFFIX = Date.now();
let tenantId: string;
let copybook: number;
let kofi: { userId: number; locationId: number };
let formSlug: string;
let formId: number;
let threeSet: number;
let phone = 0;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
const status = (id: number, to: any) => inTenant(() => orderService.updateOrderStatus(id, { status: to }));
const setCost = (cogs: number) => prismaBase.product.update({ where: { id: copybook }, data: { cogs } });
const landed = async (id: number) => (await prismaBase.order.findUniqueOrThrow({ where: { id } })).landedCostTotal;
const entriesOf = (id: number) => prismaBase.journalEntry.findMany({
  where: { tenantId, sourceType: { in: ['order_delivery', 'order_return'] }, sourceId: id }, orderBy: { id: 'asc' },
  include: { transactions: { include: { account: true } } },
});
/** Net debit (debit - credit) per account code over the given entries. */
const net = (entries: Awaited<ReturnType<typeof entriesOf>>) => {
  const out: Record<string, number> = {};
  for (const e of entries) for (const t of e.transactions) out[t.account.code] = (out[t.account.code] ?? 0) + Number(t.debitAmount) - Number(t.creditAmount);
  return out;
};
const leg = (entry: Awaited<ReturnType<typeof entriesOf>>[number], code: string) =>
  entry.transactions.filter((t) => t.account.code === code).map((t) => [Number(t.debitAmount), Number(t.creditAmount)]);

async function deliveredOrder() {
  phone += 1;
  const created = await inTenant(() => publicOrderService.createPublicOrder(formSlug, {
    firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+23355${String(SUFFIX).slice(-6)}${phone}`,
    deliveryAddress: '5 Test Rd', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
    selectedPackageId: threeSet, selectedUpsellIds: [],
  }));
  await prismaBase.order.update({ where: { id: created.orderId }, data: { deliveryAgentId: kofi.userId } });
  await status(created.orderId, 'confirmed');
  await status(created.orderId, 'out_for_delivery');
  return created.orderId;
}

beforeAll(async () => {
  tenantId = (await createTenant('Landed Cost', { currency: 'GHS' })).id;
  await seedTenantDefaults(tenantId);
  copybook = (await prismaBase.product.create({ data: { sku: `LC-COPY-${SUFFIX}`, name: 'Copybook', category: 'x', price: 100, cogs: 20, stockQuantity: 0, tenantId } })).id;
  const user = await prismaBase.user.create({ data: { email: `lc-kofi-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Kofi', lastName: 'Agent', role: 'delivery_agent', tenantId } });
  const locationId = await stockUp(tenantId, copybook, 500, { name: 'Kofi Agent', type: 'agent', userId: user.id });
  kofi = { userId: user.id, locationId };
  formSlug = `lc-form-${SUFFIX}`;
  formId = (await prismaBase.checkoutForm.create({ data: { name: 'LC Form', slug: formSlug, productId: copybook, fields: {}, styling: {}, regions: [], tenantId } })).id;
  threeSet = (await prismaBase.formPackage.create({ data: { formId, name: '3 sets', price: 300, quantity: 3 } })).id;
}, 60_000);

afterAll(async () => {
  await prismaBase.formSubmission.deleteMany({ where: { formId } });
  await prismaBase.formPackage.deleteMany({ where: { formId } });
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('landed cost on a delivered order (F-611)', () => {
  it('stores quantity x product cost at delivery, and the revenue entry books the same COGS', async () => {
    await setCost(20);
    const id = await deliveredOrder();
    expect(await landed(id)).toBeNull(); // nothing before delivery
    await status(id, 'delivered');
    expect(Number(await landed(id))).toBe(60); // 3 x 20
    const [entry] = await entriesOf(id);
    expect(entry.sourceType).toBe('order_delivery');
    expect(leg(entry, '5010')).toEqual([[60, 0]]);
    expect(leg(entry, '1200')).toEqual([[0, 60]]);
  });

  it('a cost change after delivery does not move the stored amount; the return reverses the booked 60 and the order nets to 0', async () => {
    await setCost(20);
    const id = await deliveredOrder();
    await status(id, 'delivered');
    await setCost(50); // cost changes after delivery
    expect(Number(await landed(id))).toBe(60);
    await status(id, 'returned');
    expect(await landed(id)).toBeNull(); // leaves delivered: the field is cleared
    const entries = await entriesOf(id);
    expect(entries.map((e) => e.sourceType)).toEqual(['order_delivery', 'order_return']);
    expect(leg(entries[1], '1200')).toEqual([[60, 0]]);
    expect(leg(entries[1], '5010')).toEqual([[0, 60]]);
    const totals = net(entries);
    expect(totals['5010']).toBe(0);
    expect(totals['1200']).toBe(0);
    expect(totals['4010']).toBe(0);
    for (const e of entries) {
      const debit = e.transactions.reduce((s, t) => s + Number(t.debitAmount), 0);
      const credit = e.transactions.reduce((s, t) => s + Number(t.creditAmount), 0);
      expect(debit).toBeCloseTo(credit, 4);
    }
  });

  it('delivering again after a return books the cost of that moment', async () => {
    await setCost(20);
    const id = await deliveredOrder();
    await status(id, 'delivered');
    await status(id, 'returned');
    await setCost(50);
    await inTenant(() => import('../../services/orderStateMachine').then((m) => m.transitionOrder(id, 'delivered', { kind: 'integration' })));
    expect(Number(await landed(id))).toBe(150); // 3 x 50
    const entries = await entriesOf(id);
    expect(entries.map((e) => e.sourceType)).toEqual(['order_delivery', 'order_return', 'order_delivery']);
    expect(leg(entries[2], '5010')).toEqual([[150, 0]]);
    expect(net(entries)['5010']).toBe(150);
  });

  it('a repeat of the delivered step keeps the stored amount', async () => {
    await setCost(20);
    const id = await deliveredOrder();
    await status(id, 'delivered');
    await setCost(80);
    await inTenant(() => prisma.$transaction((tx) => fulfilOrder(tx, { id, deliveryAgentId: kofi.userId })));
    expect(Number(await landed(id))).toBe(60);
    await status(id, 'delivered');
    expect(Number(await landed(id))).toBe(60);
  });
});

describe('orders delivered before this change (no backfill, "as booked")', () => {
  it('a null-landed delivered order reverses with the COGS of its own entry, not today\'s cost', async () => {
    await setCost(20);
    const id = await deliveredOrder();
    await status(id, 'delivered');
    await prismaBase.order.update({ where: { id }, data: { landedCostTotal: null } }); // as an order delivered before M4
    await setCost(35);
    await status(id, 'returned');
    const entries = await entriesOf(id);
    expect(leg(entries[0], '5010')).toEqual([[60, 0]]);
    expect(leg(entries[1], '5010')).toEqual([[0, 60]]); // 3 x 20 booked, not 3 x 35
    expect(leg(entries[1], '1200')).toEqual([[60, 0]]);
    const totals = net(entries);
    expect([totals['5010'], totals['1200']]).toEqual([0, 0]);
  });

  it('orders delivered before 1 October have no landed cost, and nothing here writes one', async () => {
    const customer = await prismaBase.customer.create({
      data: { firstName: 'Old', lastName: 'Buyer', phoneNumber: `+2332${SUFFIX}`.slice(0, 15), address: '1 Old Rd', state: 'Greater Accra', area: 'Accra', tenantId },
    });
    const old = await prismaBase.order.create({
      data: { customerId: customer.id, subtotal: 10, totalAmount: 10, status: 'delivered', deliveryDate: new Date('2026-09-15T10:00:00Z'), tenantId },
    });
    expect(await landed(old.id)).toBeNull();
    expect(await prismaBase.order.count({ where: { tenantId, deliveryDate: { lt: new Date('2026-10-01T00:00:00Z') }, landedCostTotal: { not: null } } })).toBe(0);
  });
});
