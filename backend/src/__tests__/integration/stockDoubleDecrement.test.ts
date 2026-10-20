/**
 * Double-decrement characterization test (M0-T04, F-657, F-305).
 *
 * Today a public checkout order lowers warehouse stock TWICE:
 *   1. publicOrderService.createPublicOrder decrements `stockQuantity` at creation.
 *   2. orderService.updateOrderStatus decrements again on entering `out_for_delivery`
 *      (transition A). Moving on to `delivered` changes nothing for a warehouse order.
 *
 * Observed on the local test DB (2026-10-20), start stock 100, no delivery agent:
 *   3-set package: after create 97 (-3), after out_for_delivery 94 (-6), after delivered 94 (-6).
 *   2-unit package (F-305): after create 98 (-2), after out_for_delivery 96 (-4), after delivered 96 (-4).
 * These match the plan's -6 / -4.
 *
 * Test A pins today's behaviour. Test B states the target (-3 / -2) and is `it.failing`;
 * M4-T08 removes `it.failing` on B and deletes A.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { runInTenant } from '../../utils/tenantContext';
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
let threeSetPackageId: number;
let twoUnitPackageId: number;
const orderIds: number[] = [];
let phoneCounter = 0;

const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);

const getStock = async () =>
  (await prismaBase.product.findUniqueOrThrow({ where: { id: productId } })).stockQuantity;

/** Creates a public order for the package, moves it out_for_delivery then delivered. Returns stock deltas. */
async function runPublicOrderToDelivered(packageId: number) {
  const before = await getStock();
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
  };
}

beforeAll(async () => {
  const tenant = await createTenant('DDec Tenant');
  tenantId = tenant.id;

  const product = await prismaBase.product.create({
    data: {
      sku: `DDEC-${SUFFIX}`,
      name: 'Double Decrement Set',
      category: 'test',
      price: 100,
      stockQuantity: START_STOCK,
      tenantId,
    },
  });
  productId = product.id;

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
  await prismaBase.product.delete({ where: { id: productId } });
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('stock double-decrement on public orders', () => {
  describe('Test A: pins today (double decrement)', () => {
    it('3-set package: -3 at creation, -3 more at out_for_delivery, none at delivered (-6 total)', async () => {
      const delta = await runPublicOrderToDelivered(threeSetPackageId);
      expect(delta).toEqual({ create: -3, dispatch: -3, total: -6 });
    });

    it('2-unit package (F-305): -2 at creation, -2 more at out_for_delivery (-4 total)', async () => {
      const delta = await runPublicOrderToDelivered(twoUnitPackageId);
      expect(delta).toEqual({ create: -2, dispatch: -2, total: -4 });
    });
  });

  describe('Test B: target (stock moves once)', () => {
    it.failing('3-set package lowers stock by 3 in total - fixed in M4-T08', async () => {
      const delta = await runPublicOrderToDelivered(threeSetPackageId);
      expect(delta.total).toBe(-3);
    });

    it.failing('2-unit package (F-305) lowers stock by 2 in total - fixed in M4-T08', async () => {
      const delta = await runPublicOrderToDelivered(twoUnitPackageId);
      expect(delta.total).toBe(-2);
    });
  });
});
