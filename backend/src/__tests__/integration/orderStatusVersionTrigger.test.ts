/**
 * M1-T01: the orders_status_version_bump trigger raises orders.status_version by 1
 * on every status change, even for raw SQL, and never counts a bump twice.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';

const SUFFIX = Date.now();
let tenantId: string;
let orderId: number;

const readVersion = async (): Promise<number> => {
  const rows = await prismaBase.$queryRaw<{ status_version: number }[]>`SELECT status_version FROM orders WHERE id = ${orderId}`;
  return rows[0].status_version;
};

beforeAll(async () => {
  const tenant = await createTenant('SV Tenant');
  tenantId = tenant.id;
  const customer = await prismaBase.customer.create({
    data: {
      firstName: 'Ama', lastName: 'Mensah', phoneNumber: `+2332${SUFFIX}`.slice(0, 15),
      address: '3 Test Rd', state: 'Greater Accra', area: 'Accra', tenantId,
    },
  });
  const order = await prismaBase.order.create({
    data: { customerId: customer.id, subtotal: 10, totalAmount: 10, tenantId },
  });
  orderId = order.id;
}, 30000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('orders_status_version_bump trigger', () => {
  it('starts at 0', async () => {
    expect(await readVersion()).toBe(0);
  });

  it('raw UPDATE of status raises status_version by 1', async () => {
    await prismaBase.$executeRaw`UPDATE orders SET status = 'confirmed' WHERE id = ${orderId}`;
    expect(await readVersion()).toBe(1);
    await prismaBase.$executeRaw`UPDATE orders SET status = 'preparing' WHERE id = ${orderId}`;
    expect(await readVersion()).toBe(2);
  });

  it('an update of another column leaves status_version alone', async () => {
    await prismaBase.$executeRaw`UPDATE orders SET notes = 'hello' WHERE id = ${orderId}`;
    expect(await readVersion()).toBe(2);
  });

  it('an update that writes the same status leaves status_version alone', async () => {
    await prismaBase.$executeRaw`UPDATE orders SET status = 'preparing' WHERE id = ${orderId}`;
    expect(await readVersion()).toBe(2);
  });

  it('an update that also sets status_version itself is not counted twice', async () => {
    await prismaBase.$executeRaw`UPDATE orders SET status = 'ready_for_pickup', status_version = status_version + 1 WHERE id = ${orderId}`;
    expect(await readVersion()).toBe(3);
  });

  it('a Prisma update of status bumps too', async () => {
    await prismaBase.order.update({ where: { id: orderId }, data: { status: 'out_for_delivery' } });
    expect(await readVersion()).toBe(4);
  });
});
