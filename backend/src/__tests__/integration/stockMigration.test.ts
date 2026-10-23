/**
 * M4-T03 / M4-T04 (COD-38): scripts/migrate-stock-to-levels.ts on a tenant that holds legacy stock only.
 * Sums equal, 3PL level, second run no change, no in-transit transfer from the counter, the two order corrections,
 * and a difference rolls the run back.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { makeCustomer } from './helpers/kpiOrders';
import { migrateTenant } from '../../../scripts/migrate-stock-to-levels';

const db = prismaBase;
const OPTS = { dryRun: false, defaultLocation: 'Logiswift' };

let tenantId: string;
let p1: number; // copybook: warehouse 100
let p2: number; // second product: warehouse 50
let logiswiftUser: number;
let kofi: number;
let orders: Record<string, number> = {};

const levelOf = async (locationName: string, productId: number) => {
  const l = await db.stockLocation.findFirst({ where: { tenantId, name: locationName } });
  if (!l) return undefined;
  return (await db.stockLevel.findUnique({ where: { locationId_productId: { locationId: l.id, productId } } }))?.quantity;
};

beforeAll(async () => {
  const tenant = await createTenant('StockMig');
  tenantId = tenant.id;
  const mkUser = (first: string, last: string, role: 'admin' | 'delivery_agent') =>
    db.user.create({ data: { email: `${first}-${tenantId}@codadmin.test`, password: 'x', firstName: first, lastName: last, role, tenantId } });
  const [admin, lw, k] = await Promise.all([mkUser('Boss', 'Owner', 'admin'), mkUser('Logiswift', 'Delivery', 'delivery_agent'), mkUser('Kofi', 'Appiah', 'delivery_agent')]);
  logiswiftUser = lw.id;
  kofi = k.id;
  const [a, b] = await Promise.all([
    db.product.create({ data: { name: 'Copybook', sku: `CB-${tenantId}`, category: 't', price: 50, stockQuantity: 100, tenantId } }),
    db.product.create({ data: { name: 'Pens', sku: `PN-${tenantId}`, category: 't', price: 10, stockQuantity: 50, tenantId } }),
  ]);
  p1 = a.id;
  p2 = b.id;
  const customer = await makeCustomer(tenantId);
  // Agent stock. Kofi's totalInTransit counter (20) must NOT become a transfer.
  await db.agentStock.createMany({ data: [
    { agentId: logiswiftUser, productId: p1, quantity: 20, tenantId },
    { agentId: kofi, productId: p1, quantity: 36, totalInTransit: 20, tenantId },
  ] });
  await db.inventoryTransfer.create({ data: { tenantId, productId: p1, quantity: 36, transferType: 'allocation', fromAgentId: null, toAgentId: kofi, createdById: admin.id } });

  const base = { customerId: customer.id, subtotal: '10', totalAmount: '10', codAmount: '10', deliveryAddress: 'x', deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId };
  const item = (productId: number, quantity: number, itemType = 'product') => ({ productId, quantity, unitPrice: '1', totalPrice: '1', itemType });
  const mk = async (key: string, data: Record<string, unknown>) => { orders[key] = (await db.order.create({ data: { ...base, ...data } as any })).id; };
  // (a) out for delivery with Kofi: 3 copybooks + 2 pens; with nobody: 1 copybook; dispatched through deliveryService: nothing taken.
  await mk('ofdKofi', { status: 'out_for_delivery', deliveryAgentId: kofi, orderItems: { create: [item(p1, 3), item(p2, 2)] } });
  await mk('ofdNobody', { status: 'out_for_delivery', orderItems: { create: [item(p1, 1)] } });
  await mk('ofdViaDelivery', { status: 'out_for_delivery', deliveryAgentId: kofi, orderItems: { create: [item(p1, 7)] } });
  await db.orderHistory.create({ data: { tenantId, orderId: orders.ofdViaDelivery, status: 'out_for_delivery', metadata: { deliveryId: 1 } } });
  // (b) COD checkout order, still pending: package line 2 copybooks (the upsell line is not decremented at creation).
  const form = await db.checkoutForm.create({ data: { name: 'F', slug: `f-${tenantId}`, productId: p1, fields: [], styling: {}, regions: [], tenantId } });
  await mk('publicPending', { status: 'pending_confirmation', source: 'checkout_form', orderItems: { create: [item(p1, 2, 'package'), item(p2, 1, 'upsell')] } });
  await db.formSubmission.create({ data: { tenantId, formId: form.id, orderId: orders.publicPending, formData: {}, selectedPackage: {}, totalAmount: '10' } });
  // A paid checkout order (no creation decrement) and closed orders get no correction.
  await mk('publicPaid', { status: 'confirmed', source: 'checkout_form', paymentProvider: 'paystack', orderItems: { create: [item(p1, 4, 'package')] } });
  await db.formSubmission.create({ data: { tenantId, formId: form.id, orderId: orders.publicPaid, formData: {}, selectedPackage: {}, totalAmount: '10' } });
  await mk('delivered', { status: 'delivered', deliveryAgentId: kofi, orderItems: { create: [item(p1, 5)] } });
  await mk('cancelled', { status: 'cancelled', orderItems: { create: [item(p1, 6)] } });
}, 60000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('migrate-stock-to-levels', () => {
  it('a dry run writes nothing and reports equal sums', async () => {
    const report = await migrateTenant(tenantId, { ...OPTS, dryRun: true });
    expect(report.ok).toBe(true);
    expect(await db.stockLocation.count({ where: { tenantId } })).toBe(0);
    expect(await db.stockLevel.count({ where: { tenantId } })).toBe(0);
    const copybook = report.rows.find((r) => r.productId === p1)!;
    // before = warehouse 100 + agents 20 + 36 + (a) 3 + 1 + (b) 2
    expect(copybook).toMatchObject({ warehouse: 100, agents: 56, correctionA: 4, correctionB: 2, before: 162, after: 162, difference: 0, inTransitCounter: 20 });
    expect(report.ordersA).toBe(2);
    expect(report.skippedDeliveryDispatch).toBe(1);
    expect(report.ordersB).toBe(1);
    expect(report.linked3pl[0].user).toContain(`user ${logiswiftUser}`);
  });

  it('the first real run builds the levels, links the 3PL user and puts back the units of open orders', async () => {
    const report = await migrateTenant(tenantId, OPTS);
    expect(report.ok).toBe(true);
    const logiswift = await db.stockLocation.findFirstOrThrow({ where: { tenantId, name: 'Logiswift' } });
    expect(logiswift).toMatchObject({ type: 'partner_3pl', userId: logiswiftUser });
    expect(await db.stockLocation.findFirst({ where: { tenantId, name: 'Kasapa Express', type: 'partner_3pl' } })).not.toBeNull();
    expect(await db.stockLocation.findFirst({ where: { tenantId, type: 'in_transit' } })).not.toBeNull();
    expect(await db.stockLocation.findFirst({ where: { tenantId, userId: kofi, type: 'agent' } })).not.toBeNull();
    // Logiswift copybook: warehouse 100 + Logiswift user's own 20 + (a) no-agent order 1 + (b) public pending 2.
    expect(await levelOf('Logiswift', p1)).toBe(123);
    expect(await levelOf('Logiswift', p2)).toBe(50);
    // Kofi copybook: AgentStock 36 + (a) 3. Pens: (a) 2.
    expect(await levelOf('Kofi Appiah', p1)).toBe(39);
    expect(await levelOf('Kofi Appiah', p2)).toBe(2);
  });

  it('sums of levels equal the old numbers per product and the 20 in transit is not counted twice', async () => {
    const sums = await db.stockLevel.groupBy({ by: ['productId'], where: { tenantId }, _sum: { quantity: true } });
    const total = (id: number) => sums.find((s) => s.productId === id)!._sum.quantity;
    expect(total(p1)).toBe(162);
    expect(total(p2)).toBe(52); // warehouse 50 + (a) 2; the upsell line of the checkout order is not corrected
    expect(await db.inventoryTransfer.count({ where: { tenantId, status: 'in_transit' } })).toBe(0);
  });

  it('old transfers get locations and stay received; corrections carry the two notes and the order', async () => {
    const old = await db.inventoryTransfer.findFirstOrThrow({ where: { tenantId, transferType: 'allocation' } });
    const kofiLoc = await db.stockLocation.findFirstOrThrow({ where: { tenantId, userId: kofi } });
    const logiswift = await db.stockLocation.findFirstOrThrow({ where: { tenantId, name: 'Logiswift' } });
    expect(old).toMatchObject({ fromLocationId: logiswift.id, toLocationId: kofiLoc.id, status: 'received' });
    const rows = await db.inventoryTransfer.findMany({ where: { tenantId, transferType: 'adjustment' }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => r.notes).sort()).toEqual([
      'Migration: checkout decrement moved to delivery',
      'Migration: stock moved from out-for-delivery to delivery',
      'Migration: stock moved from out-for-delivery to delivery',
      'Migration: stock moved from out-for-delivery to delivery',
    ]);
    expect(rows.every((r) => r.orderId != null && r.status === 'received')).toBe(true);
  });

  it('never writes AgentStock or Product.stockQuantity', async () => {
    const stock = await db.agentStock.findMany({ where: { tenantId }, orderBy: { agentId: 'asc' } });
    expect(stock.map((s) => [s.quantity, s.totalInTransit]).sort()).toEqual([[20, 0], [36, 20]]);
    expect((await db.product.findUniqueOrThrow({ where: { id: p1 } })).stockQuantity).toBe(100);
  });

  it('a second run changes nothing', async () => {
    const snapshot = async () => ({
      locations: await db.stockLocation.count({ where: { tenantId } }),
      levels: JSON.stringify(await db.stockLevel.findMany({ where: { tenantId }, orderBy: { id: 'asc' }, select: { id: true, quantity: true } })),
      transfers: await db.inventoryTransfer.count({ where: { tenantId } }),
    });
    const before = await snapshot();
    const report = await migrateTenant(tenantId, OPTS);
    expect(report.alreadyMigrated).toBe(true);
    expect(await snapshot()).toEqual(before);
  });
});

describe('a sum difference fails the run and rolls it back', () => {
  let other: string;
  beforeAll(async () => {
    other = (await createTenant('StockMig2')).id;
    await db.product.create({ data: { name: 'P', sku: `X-${other}`, category: 't', price: 1, stockQuantity: 10, tenantId: other } });
  });
  afterAll(async () => { await deleteTenantRows([other]); });

  it('throws and leaves no location, level or movement', async () => {
    await expect(migrateTenant(other, {
      ...OPTS,
      beforeVerify: async (tx, id) => {
        const level = await tx.stockLevel.findFirstOrThrow({ where: { tenantId: id } });
        await tx.stockLevel.update({ where: { id: level.id }, data: { quantity: { increment: 1 } } });
      },
    })).rejects.toThrow(/rolled back/);
    expect(await db.stockLocation.count({ where: { tenantId: other } })).toBe(0);
    expect(await db.stockLevel.count({ where: { tenantId: other } })).toBe(0);
    expect(await db.inventoryTransfer.count({ where: { tenantId: other } })).toBe(0);
  });
});
