/**
 * M0-T24 (COD-6): money in API and MCP output is a string with exactly 2 decimals.
 * Contract: GET /api/orders, GET /api/financial/summary and the MCP `orders_summary` tool.
 * The 2-decimal rule comes from one place: Money.jsonReplacer (Express `json replacer`, mcpJson).
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { tenantStorage } from '../../utils/tenantContext';
import { registerOrderTools } from '../../mcp/tools/orders';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const SUFFIX = Date.now();
const TWO_DECIMALS = /^-?\d+\.\d{2}$/;
let tenantId: string;
let admin: { id: number; email: string; role: any; tenantId: string | null };

beforeAll(async () => {
  const tenant = await prismaBase.tenant.create({ data: { name: `Money ${SUFFIX}`, slug: `money-${SUFFIX}` } });
  tenantId = tenant.id;
  admin = await prismaBase.user.create({
    data: { email: `money-admin-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Money', lastName: 'Admin', role: 'admin', tenantId },
  });
  const customer = await prismaBase.customer.create({
    data: { firstName: 'Ama', lastName: 'T', phoneNumber: `+23355${String(SUFFIX).slice(-7)}`, address: '1 St', state: 'Greater Accra', area: 'Accra', tenantId },
  });
  const order = await prismaBase.order.create({
    data: {
      customerId: customer.id, subtotal: 249, shippingCost: 0, totalAmount: 249, codAmount: 249,
      deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId, status: 'delivered',
    } as any,
  });
  await prismaBase.transaction.create({
    data: { orderId: order.id, type: 'cod_collection', amount: 249, paymentMethod: 'cash', status: 'collected', tenantId } as any,
  });
});

afterAll(async () => {
  await prismaBase.transaction.deleteMany({ where: { tenantId } });
  await prismaBase.order.deleteMany({ where: { tenantId } });
  await prismaBase.customer.deleteMany({ where: { tenantId } });
  await prismaBase.user.deleteMany({ where: { tenantId } });
  await prismaBase.tenant.deleteMany({ where: { id: tenantId } });
  await prismaBase.$disconnect();
});

const auth = () => ({
  Authorization: `Bearer ${generateAccessToken({ id: admin.id, email: admin.email, role: admin.role, tenantId: admin.tenantId })}`,
});

describe('money contract', () => {
  it('GET /api/orders returns order money as 2-decimal strings', async () => {
    const res = await request(app).get('/api/orders').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(1);
    const order = res.body.orders[0];
    for (const field of ['subtotal', 'shippingCost', 'discount', 'totalAmount', 'codAmount', 'depositPaid', 'balanceDue']) {
      expect(order[field]).toMatch(TWO_DECIMALS);
    }
    expect(order.totalAmount).toBe('249.00');
    expect(order.shippingCost).toBe('0.00');
  });

  it('GET /api/financial/summary returns money as 2-decimal strings', async () => {
    const res = await request(app).get('/api/financial/summary').set(auth());
    expect(res.status).toBe(200);
    const { summary } = res.body;
    for (const field of ['totalRevenue', 'totalExpenses', 'profit', 'codCollected', 'codPending', 'outstandingReceivables']) {
      expect(summary[field]).toMatch(TWO_DECIMALS);
    }
    expect(summary.codCollected).toBe('249.00');
    // A rate is a number, not money
    expect(typeof summary.profitMargin).toBe('number');
  });

  it('MCP orders_summary returns revenue as a 2-decimal string with a currency code', async () => {
    const tools: Record<string, (args: any) => Promise<any>> = {};
    registerOrderTools({ tool: (name: string, _d: string, _s: unknown, handler: any) => { tools[name] = handler; } } as any, (h) => h);
    const result = await tenantStorage.run({ tenantId }, () => tools.orders_summary({ period: 'today' }));
    const body = JSON.parse(result.content[0].text);
    expect(body.revenue).toBe('249.00');
    expect(body.currency).toMatch(/^[A-Z]{3}$/);
  });
});
