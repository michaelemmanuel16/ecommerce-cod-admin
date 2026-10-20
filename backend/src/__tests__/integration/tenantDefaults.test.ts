/**
 * M0-T13 (COD-4): seedTenantDefaults is idempotent, register-tenant and platform
 * create-tenant seed the new tenant, and two tenants each post a delivery into
 * their own account 4010.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import prisma from '../../utils/prisma';
import { tenantStorage } from '../../utils/tenantContext';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { createTenant } from '../../services/platformService';
import { DeliveryService } from '../../services/deliveryService';
import { DEFAULT_GL_ACCOUNTS, GL_ACCOUNTS } from '../../config/glAccounts';
import { DEFAULT_EMAIL_TEMPLATES } from '../../services/emailTemplateService';

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
const tenantIds: string[] = [];

const mkTenant = async (label: string) => {
  const t = await prismaBase.tenant.create({ data: { name: `Defaults ${label} ${SUFFIX}`, slug: `defaults-${label}-${SUFFIX}` } });
  tenantIds.push(t.id);
  return t.id;
};

const counts = async (tenantId: string) => ({
  accounts: await prismaBase.account.count({ where: { tenantId } }),
  emailTemplates: await prismaBase.emailTemplate.count({ where: { tenantId } }),
});

afterAll(async () => {
  // Own rows only. Order items block the product delete that the tenant cascade runs.
  const inTenants = { tenantId: { in: tenantIds } };
  await prismaBase.orderItem.deleteMany({ where: { order: inTenants } });
  await prismaBase.delivery.deleteMany({ where: { order: inTenants } });
  await prismaBase.order.deleteMany({ where: inTenants });
  await prismaBase.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prismaBase.$disconnect();
});

describe('seedTenantDefaults', () => {
  it('the chart has 16 accounts, one per GL_ACCOUNTS code', () => {
    expect(DEFAULT_GL_ACCOUNTS).toHaveLength(16);
    expect(new Set(DEFAULT_GL_ACCOUNTS.map((a) => a.code))).toEqual(new Set(Object.values(GL_ACCOUNTS)));
  });

  it('running twice gives the same row counts', async () => {
    const id = await mkTenant('idem');
    const first = await seedTenantDefaults(id);
    expect(first.accounts).toBe(16);
    const after1 = await counts(id);
    const second = await seedTenantDefaults(id);
    expect(second).toEqual({ accounts: 0, emailTemplates: 0 });
    expect(await counts(id)).toEqual(after1);
    expect(after1).toEqual({ accounts: 16, emailTemplates: DEFAULT_EMAIL_TEMPLATES.length });
  });

  it('fills only what is missing', async () => {
    const id = await mkTenant('partial');
    await seedTenantDefaults(id);
    await prismaBase.account.deleteMany({ where: { tenantId: id, code: GL_ACCOUNTS.COGS } });
    const res = await seedTenantDefaults(id);
    expect(res.accounts).toBe(1);
    expect((await counts(id)).accounts).toBe(16);
  });

  it('register-tenant gives the new tenant the full chart and email templates', async () => {
    const res = await request(app).post('/api/auth/register-tenant').send({
      companyName: `Reg Defaults ${SUFFIX}`,
      adminEmail: `defaults-reg-${SUFFIX}@codadmin.test`,
      adminPassword: 'Passw0rd!test',
      adminName: 'Reg Admin',
    });
    expect(res.status).toBe(201);
    tenantIds.push(res.body.tenant.id);
    expect(await counts(res.body.tenant.id)).toEqual({ accounts: 16, emailTemplates: DEFAULT_EMAIL_TEMPLATES.length });
  });

  it('platform createTenant seeds the new tenant', async () => {
    const t = await createTenant({ name: `Plat Defaults ${SUFFIX}`, slug: `defaults-plat-${SUFFIX}` });
    tenantIds.push(t.id);
    expect(await counts(t.id)).toEqual({ accounts: 16, emailTemplates: DEFAULT_EMAIL_TEMPLATES.length });
  });
});

describe('two tenants each post a delivery', () => {
  const setup = async (label: string, amount: number) => {
    const tenantId = await mkTenant(`gl-${label}`);
    await seedTenantDefaults(tenantId);
    return tenantStorage.run({ tenantId }, async () => {
      const admin = await prisma.user.create({
        data: { email: `gl-admin-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'A', lastName: label, role: 'admin', phoneNumber: `0${SUFFIX}1` },
      });
      const agent = await prisma.user.create({
        data: { email: `gl-agent-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'G', lastName: label, role: 'delivery_agent', phoneNumber: `0${SUFFIX}2` },
      });
      const customer = await prisma.customer.create({
        data: { firstName: 'C', lastName: label, phoneNumber: `0${SUFFIX}3`, address: 'Addr', state: 'S', area: 'A' },
      });
      const product = await prisma.product.create({
        data: { name: `P ${label}`, price: amount, stockQuantity: 10, sku: `GL-${label}-${SUFFIX}`, category: 'T' },
      });
      const order = await prisma.order.create({
        data: {
          customerId: customer.id, totalAmount: amount, subtotal: amount, shippingCost: 0,
          deliveryAddress: 'Addr', deliveryState: 'S', deliveryArea: 'A',
          status: 'out_for_delivery', deliveryAgentId: agent.id,
          orderItems: { create: [{ productId: product.id, quantity: 1, unitPrice: amount, totalPrice: amount }] },
        },
      });
      const delivery = await prisma.delivery.create({ data: { orderId: order.id, agentId: agent.id, scheduledTime: new Date() } });
      await new DeliveryService().completeDelivery(
        delivery.id.toString(),
        { proofType: 'signature', proofData: 'sig.png', recipientName: 'R' },
        admin.id.toString()
      );
      return tenantId;
    });
  };

  it('each tenant has revenue in its own 4010 and none in the other', async () => {
    const a = await setup('a', 100);
    const b = await setup('b', 250);
    const revenue = async (tenantId: string) => {
      const acc = await prismaBase.account.findFirst({ where: { tenantId, code: GL_ACCOUNTS.PRODUCT_REVENUE } });
      const rows = await prismaBase.accountTransaction.findMany({ where: { accountId: acc!.id } });
      return { rows, credit: rows.reduce((s, r) => s + Number(r.creditAmount), 0), tenants: new Set(rows.map((r) => r.tenantId)) };
    };
    const ra = await revenue(a);
    const rb = await revenue(b);
    expect(ra.credit).toBe(100);
    expect(rb.credit).toBe(250);
    expect([...ra.tenants]).toEqual([a]);
    expect([...rb.tenants]).toEqual([b]);
  });
});
