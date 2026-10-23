/**
 * Stock leaves once per order (M0-T04, M4-T08, F-657, F-305).
 *
 * Before M4 a public checkout order lowered warehouse stock twice: at creation (publicOrderService) and again when
 * the state machine took it at `out_for_delivery`. Observed on 2026-10-20, start 100, no agent stock:
 *   3-set package: create 97 (-3), out_for_delivery 94 (-6), delivered 94 (-6).
 *   2-unit package: create 98 (-2), out_for_delivery 96 (-4), delivered 96 (-4).
 * Now stock moves once, at `delivered`, from the holder: -3 for the 3-set package and -2 for the 2-unit package.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { runInTenant } from '../../utils/tenantContext';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { levelAt, stockUp } from './helpers/stock';
import orderService from '../../services/orderService';
import publicOrderService from '../../services/publicOrderService';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({
    to: jest.fn(() => ({ emit: jest.fn() })),
    emit: jest.fn(),
  })),
  hasSocketInstance: jest.fn(() => true),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const SUFFIX = Date.now();
const START_STOCK = 100;

let tenantId: string;
let productId: number;
let formId: number;
let formSlug: string;
let agentId: number;
let holderId: number;
let threeSetPackageId: number;
let twoUnitPackageId: number;
const orderIds: number[] = [];
let phoneCounter = 0;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);

/** On hand at the holder (the agent's location) and the Product.stockQuantity cache. */
const getStock = async () => levelAt(holderId, productId);
const getCache = async () => (await prismaBase.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity;

/** Creates a public order for the package, moves it out_for_delivery then delivered. Returns stock deltas. */
async function runPublicOrderToDelivered(packageId: number) {
  const before = await getStock();
  const cacheBefore = await getCache();
  phoneCounter += 1;

  const created = await inTenant(() =>
    publicOrderService.createPublicOrder(formSlug, {
      firstName: 'Ama',
      lastName: 'Mensah',
      phoneNumber: `+23355${String(SUFFIX).slice(-6)}${phoneCounter}`,
      deliveryAddress: '5 Test Rd',
      deliveryState: 'Greater Accra',
      deliveryArea: 'Accra',
      selectedPackageId: packageId,
    }),
  );
  orderIds.push(created.orderId);
  // out_for_delivery needs a delivery agent (state machine). The agent's location holds the stock.
  await prismaBase.order.update({ where: { id: created.orderId }, data: { deliveryAgentId: agentId } });
  const afterCreate = await getStock();

  await inTenant(() => orderService.updateOrderStatus(created.orderId, { status: 'confirmed' }));
  await inTenant(() => orderService.updateOrderStatus(created.orderId, { status: 'out_for_delivery' }));
  const afterDispatch = await getStock();

  await inTenant(() => orderService.updateOrderStatus(created.orderId, { status: 'delivered' }));
  const afterDelivered = await getStock();

  return {
    create: afterCreate - before,
    dispatch: afterDispatch - afterCreate,
    total: afterDelivered - before,
    cache: (await getCache()) - cacheBefore,
  };
}

beforeAll(async () => {
  const tenant = await createTenant('DDec Tenant');
  tenantId = tenant.id;
  await seedTenantDefaults(tenantId); // chart of accounts, and the system user a no-actor delivered move posts as
  agentId = (await prismaBase.user.create({
    data: { email: `ddec-agent-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Kofi', lastName: 'Agent', role: 'delivery_agent', tenantId },
  })).id;

  const product = await prismaBase.product.create({
    data: {
      sku: `DDEC-${SUFFIX}`,
      name: 'Double Decrement Set',
      category: 'test',
      price: 100,
      stockQuantity: 0,
      tenantId,
    },
  });
  productId = product.id;
  holderId = await stockUp(tenantId, productId, START_STOCK, { name: 'Kofi Agent', type: 'agent', userId: agentId });

  formSlug = `ddec-form-${SUFFIX}`;
  const form = await prismaBase.checkoutForm.create({
    data: {
      name: 'DDec Form',
      slug: formSlug,
      productId,
      fields: {},
      styling: {},
      regions: [],
      tenantId,
    },
  });
  formId = form.id;

  const threeSet = await prismaBase.formPackage.create({
    data: { formId, name: '3 sets', price: 300, quantity: 3 },
  });
  const twoUnit = await prismaBase.formPackage.create({
    data: { formId, name: '2 units', price: 200, quantity: 2 },
  });
  threeSetPackageId = threeSet.id;
  twoUnitPackageId = twoUnit.id;
});

afterAll(async () => {
  await prismaBase.formSubmission.deleteMany({ where: { formId } });
  await prismaBase.orderHistory.deleteMany({ where: { orderId: { in: orderIds } } });
  await prismaBase.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
  await prismaBase.order.deleteMany({ where: { id: { in: orderIds } } });
  await prismaBase.customer.deleteMany({ where: { tenantId } });
  await prismaBase.formPackage.deleteMany({ where: { formId } });
  await prismaBase.checkoutForm.delete({ where: { id: formId } });
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('stock leaves once per order', () => {
  it('3-set package: nothing at creation or dispatch, -3 at delivered, from the holder', async () => {
    const delta = await runPublicOrderToDelivered(threeSetPackageId);
    expect(delta).toEqual({ create: 0, dispatch: 0, total: -3, cache: -3 });
  });

  it('2-unit package (F-305): -2 in total', async () => {
    const delta = await runPublicOrderToDelivered(twoUnitPackageId);
    expect(delta).toEqual({ create: 0, dispatch: 0, total: -2, cache: -2 });
  });
});
