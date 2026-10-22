/**
 * COD-139: Revenue by State (Sales) and Delivery success by State (Delivery) group by Order.deliveryState.
 * "Greater Accra (Tema)" counts as "Greater Accra", an empty state reads "Not set", and another tenant's states never appear.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
jest.mock('../../middleware/bulkRateLimiter', () => ({
  bulkOrderRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  bulkImportRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { baseState } from '../../utils/regions';
import { createTwoTenants, TwoTenants, TestTenant } from './helpers/twoTenants';

let pair: TwoTenants;
// A range far from today, so the order each test tenant starts with is outside it
const RANGE = 'from=2025-03-01&to=2025-03-31';
const at = new Date('2025-03-05T10:00:00Z');

const body = async (token: string, tab: string) =>
  (await request(app).get(`/api/reports/${tab}?${RANGE}`).set('Authorization', `Bearer ${token}`)).body;

async function order(t: TestTenant, state: string | null, amount: number, status: 'delivered' | 'failed_delivery' = 'delivered') {
  const own = await prismaBase.order.findUniqueOrThrow({ where: { id: t.ids.order } });
  await prismaBase.order.create({
    data: {
      customerId: own.customerId, createdAt: at, shippingCost: 0, deliveryAddress: 'x', deliveryState: state, deliveryArea: 'Same Town',
      tenantId: t.id, deliveryAgentId: t.users.deliveryAgent.id, customerRepId: t.users.salesRep.id,
      subtotal: amount, totalAmount: amount, codAmount: amount, confirmedById: t.users.salesRep.id,
      status, ...(status === 'delivered' ? { deliveryDate: at } : { failureReason: 'refused' as const }),
    },
  });
}

beforeAll(async () => {
  pair = await createTwoTenants('bystate');
  await Promise.all([
    order(pair.a, 'Ashanti', 500), order(pair.a, 'Greater Accra', 100), order(pair.a, 'Greater Accra (Tema)', 200),
    order(pair.a, ' Greater Accra ', 40), order(pair.a, null, 50), order(pair.a, '', 10),
    order(pair.a, 'Ashanti', 0, 'failed_delivery'), order(pair.a, 'Greater Accra (Tema)', 0, 'failed_delivery'),
    order(pair.b, 'Volta', 9000),
  ]);
}, 60000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('baseState', () => {
  it('drops a trailing bracket and trims', () => {
    expect(baseState('Greater Accra (Tema)')).toBe('Greater Accra');
    expect(baseState('  Ashanti ')).toBe('Ashanti');
    expect(baseState(null)).toBe('');
  });
});

describe('Reports by State', () => {
  it('Revenue by State merges the Tema variant into Greater Accra and reads an empty state as Not set', async () => {
    const { byState } = await body(pair.a.users.admin.token, 'sales');
    expect(byState.label).toBe('State');
    expect(byState.rows.map((r: any) => [r.state, r.delivered, r.revenue])).toEqual([
      ['Ashanti', 1, '500.00'],
      ['Greater Accra', 3, '340.00'],
      ['Not set', 2, '60.00'],
    ]);
    expect(byState.total).toMatchObject({ delivered: 6, revenue: '900.00' });
  });

  it('Delivery success by State uses the same grouping', async () => {
    const { successByState } = await body(pair.a.users.admin.token, 'delivery');
    expect(successByState.label).toBe('State');
    const rows = Object.fromEntries(successByState.rows.map((r: any) => [r.state, r]));
    expect(Object.keys(rows).sort()).toEqual(['Ashanti', 'Greater Accra', 'Not set']);
    expect(rows['Greater Accra']).toMatchObject({ placed: 4, delivered: 3, failed: 1, closed: 4 });
    expect(rows.Ashanti).toMatchObject({ placed: 2, delivered: 1, failed: 1 });
    expect(rows['Not set']).toMatchObject({ placed: 2, delivered: 2 });
  });

  it('tenant B sees only its own state and tenant A sees none of it', async () => {
    const b = await body(pair.b.users.admin.token, 'sales');
    expect(b.byState.rows.map((r: any) => r.state)).toEqual(['Volta']);
    const a = await body(pair.a.users.admin.token, 'sales');
    expect(JSON.stringify(a)).not.toContain('Volta');
    expect(JSON.stringify(await body(pair.a.users.admin.token, 'delivery'))).not.toContain('Volta');
  });
});
