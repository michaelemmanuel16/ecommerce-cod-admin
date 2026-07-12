/**
 * The Logiswift backfill marks June deliveries as delivered in July. If the
 * service keeps hardcoding `new Date()`, financialSyncService stamps the GL
 * collection date with today (financialSyncService.ts:144) and June's revenue
 * lands in July's period. These tests pin the fix.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { prismaBase } from '../../utils/prisma';
import { tenantStorage } from '../../utils/tenantContext';
import orderService from '../../services/orderService';

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
let tenantId: string;
let orderIds: number[] = [];

beforeAll(async () => {
  const tenant = await prismaBase.tenant.create({
    data: { name: `DD Tenant ${SUFFIX}`, slug: `dd-${SUFFIX}` },
  });
  tenantId = tenant.id;

  const customer = await prismaBase.customer.create({
    data: {
      firstName: 'Kofi', lastName: 'Owusu',
      phoneNumber: `+2332${SUFFIX}`.slice(0, 15),
      address: '2 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId,
    },
  });

  // Two orders: one gets an explicit date, one gets none.
  for (let i = 0; i < 2; i++) {
    const order = await prismaBase.order.create({
      data: {
        customerId: customer.id, status: 'confirmed',
        subtotal: 100, shippingCost: 0, totalAmount: 100,
        deliveryAddress: '2 Test Rd', deliveryState: 'Greater Accra', deliveryArea: 'Accra',
        tenantId,
      },
    });
    orderIds.push(order.id);
  }
});

afterAll(async () => {
  await prismaBase.orderHistory.deleteMany({ where: { orderId: { in: orderIds } } });
  await prismaBase.order.deleteMany({ where: { id: { in: orderIds } } });
  await prismaBase.customer.deleteMany({ where: { tenantId } });
  await prismaBase.tenant.delete({ where: { id: tenantId } });
  await prismaBase.$disconnect();
});

describe('updateOrderStatus deliveryDate', () => {
  it('uses the supplied deliveryDate when marking delivered', async () => {
    const backdated = new Date('2026-06-17T00:00:00.000Z');

    await tenantStorage.run({ tenantId }, () =>
      orderService.updateOrderStatus(orderIds[0], {
        status: 'delivered',
        deliveryDate: backdated,
        notes: 'Logiswift ESD123 · shipped 2026-06-15',
      }),
    );

    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: orderIds[0] } });
    expect(order.deliveryDate?.toISOString()).toBe(backdated.toISOString());
    expect(order.paymentStatus).toBe('collected');
  });

  it('falls back to now when no deliveryDate is supplied', async () => {
    const before = Date.now();

    await tenantStorage.run({ tenantId }, () =>
      orderService.updateOrderStatus(orderIds[1], { status: 'delivered' }),
    );

    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: orderIds[1] } });
    expect(order.deliveryDate!.getTime()).toBeGreaterThanOrEqual(before);
  });
});
