/**
 * M7-T06 (COD-64, F-357): Refusal rule service.
 * - Update customer counters (deliveredOrders, refusedOrders) on delivered, failed and returned outcomes
 * - 1 refusal: no change (normal risk, not blocked)
 * - 2 refusals: riskLevel = high
 * - 3 refusals: codBlocked = true
 * - Next new order gets requiresManualCall = true
 * - POST /api/customers/:id/cod-override clears block, restarts refusal count at 0
 * - Corrections and idempotence
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { transitionOrder, TransitionActor } from '../../services/orderStateMachine';
import orderService from '../../services/orderService';
import { runInTenant } from '../../utils/tenantContext';
import { customerNeedsManualCall } from '../../services/refusalRuleService';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { registerCustomerStatsListeners } from '../../services/customerStatsService';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const phone = (n: number) => `+23324${String(SUFFIX).slice(-6)}${String(n).padStart(2, '0')}`;

let tenantId: string;
let ownerToken: string;
let managerToken: string;
let repToken: string;
let ownerId: number;
let repId: number;
let agentId: number;
let productId: number;
let customerId: number;

const adminActor = (): TransitionActor => ({ kind: 'user', userId: ownerId, role: 'super_admin' });

const getCustomer = () => prismaBase.customer.findUniqueOrThrow({ where: { id: customerId } });

const until = async (check: (c: Awaited<ReturnType<typeof getCustomer>>) => boolean) => {
  for (let i = 0; i < 50; i++) {
    const c = await getCustomer();
    if (check(c)) return c;
    await new Promise((r) => setTimeout(r, 100));
  }
  return getCustomer();
};

beforeAll(async () => {
  registerCustomerStatsListeners();
  const tenant = await createTenant('Refusal Rule Tenant');
  tenantId = tenant.id;
  await seedTenantDefaults(tenantId);

  const owner = await prismaBase.user.create({
    data: { email: `owner-${SUFFIX}@refusal.test`, password: 'x', firstName: 'Owner', lastName: 'User', role: 'super_admin', tenantId },
  });
  ownerId = owner.id;
  ownerToken = generateAccessToken({ id: owner.id, email: owner.email, role: 'super_admin', tenantId });

  const manager = await prismaBase.user.create({
    data: { email: `mgr-${SUFFIX}@refusal.test`, password: 'x', firstName: 'Manager', lastName: 'User', role: 'manager', tenantId },
  });
  managerToken = generateAccessToken({ id: manager.id, email: manager.email, role: 'manager', tenantId });

  const rep = await prismaBase.user.create({
    data: { email: `rep-${SUFFIX}@refusal.test`, password: 'x', firstName: 'Rep', lastName: 'User', role: 'sales_rep', tenantId },
  });
  repId = rep.id;
  repToken = generateAccessToken({ id: rep.id, email: rep.email, role: 'sales_rep', tenantId });

  const agent = await prismaBase.user.create({
    data: { email: `agent-${SUFFIX}@refusal.test`, password: 'x', firstName: 'Agent', lastName: 'User', role: 'delivery_agent', tenantId },
  });
  agentId = agent.id;

  const product = await prismaBase.product.create({
    data: {
      name: 'Test Product',
      sku: `PROD-${SUFFIX}`,
      category: 'General',
      productType: 'digital',
      price: 100,
      stockQuantity: 100,
      tenantId,
    },
  });
  productId = product.id;

  const customer = await prismaBase.customer.create({
    data: {
      firstName: 'Yaw',
      lastName: 'Boateng',
      phoneNumber: phone(1),
      address: '10 High Street',
      state: 'Greater Accra',
      area: 'Accra',
      tenantId,
    },
  });
  customerId = customer.id;
});

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('M7-T06 Refusal rule service integration', () => {
  let order1Id: number;
  let order2Id: number;
  let order3Id: number;

  const createOrderDirect = async (extra: Record<string, unknown> = {}) => {
    return prismaBase.order.create({
      data: {
        customerId,
        status: 'out_for_delivery',
        deliveryAgentId: agentId,
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        tenantId,
        deliveryAddress: '10 High Street',
        deliveryState: 'Greater Accra',
        deliveryArea: 'Accra',
        ...extra,
      } as any,
    });
  };

  it('initially customer has 0 refusals, normal risk, and not codBlocked', async () => {
    const c = await getCustomer();
    expect(c.refusedOrders).toBe(0);
    expect(c.riskLevel).toBe('normal');
    expect(c.codBlocked).toBe(false);
    expect(customerNeedsManualCall(c)).toBe(false);
  });

  it('1 refusal: no change (normal risk, codBlocked=false)', async () => {
    const o1 = await createOrderDirect();
    order1Id = o1.id;

    await runInTenant(tenantId, () =>
      transitionOrder(order1Id, 'returned', adminActor(), { failureReason: 'refused' })
    );

    const c = await until((x) => x.refusedOrders === 1);
    expect(c.refusedOrders).toBe(1);
    expect(c.riskLevel).toBe('normal');
    expect(c.codBlocked).toBe(false);
    expect(customerNeedsManualCall(c)).toBe(false);
  });

  it('2 refusals: riskLevel=high, codBlocked=false', async () => {
    const o2 = await createOrderDirect();
    order2Id = o2.id;

    await runInTenant(tenantId, () =>
      transitionOrder(order2Id, 'failed_delivery', adminActor(), { failureReason: 'refused' })
    );

    const c = await until((x) => x.refusedOrders === 2);
    expect(c.refusedOrders).toBe(2);
    expect(c.riskLevel).toBe('high');
    expect(c.codBlocked).toBe(false);
    expect(customerNeedsManualCall(c)).toBe(false);
  });

  it('3 refusals: codBlocked=true, riskLevel=high', async () => {
    const o3 = await createOrderDirect();
    order3Id = o3.id;

    await runInTenant(tenantId, () =>
      transitionOrder(order3Id, 'returned', adminActor(), { failureReason: 'refused' })
    );

    const c = await until((x) => x.refusedOrders === 3);
    expect(c.refusedOrders).toBe(3);
    expect(c.riskLevel).toBe('high');
    expect(c.codBlocked).toBe(true);
    expect(customerNeedsManualCall(c)).toBe(true);
  });

  it("next new order gets requiresManualCall=true when customer is COD blocked", async () => {
    const newOrder = await runInTenant(tenantId, () =>
      orderService.createOrder({
        customerId,
        orderItems: [{ productId, quantity: 1, unitPrice: 100 }],
        totalAmount: 100,
        deliveryAddress: '10 High Street',
        deliveryState: 'Greater Accra',
        deliveryArea: 'Accra',
      })
    );

    expect(newOrder.requiresManualCall).toBe(true);
  });

  describe('POST /api/customers/:id/cod-override', () => {
    it('rep is forbidden (403)', async () => {
      const res = await request(app)
        .post(`/api/customers/${customerId}/cod-override`)
        .set(bearer(repToken))
        .send({ allow: true, note: 'Rep trying to override' });
      expect(res.status).toBe(403);
    });

    it('missing note returns 400', async () => {
      const res = await request(app)
        .post(`/api/customers/${customerId}/cod-override`)
        .set(bearer(ownerToken))
        .send({ allow: true });
      expect(res.status).toBe(400);
    });

    it('owner can override: clears block, restarts refusal count at 0, stores who/when/why', async () => {
      const res = await request(app)
        .post(`/api/customers/${customerId}/cod-override`)
        .set(bearer(ownerToken))
        .send({ allow: true, note: 'Customer deposited GH₵50 and promised acceptance' });

      expect(res.status).toBe(200);
      expect(res.body.customer.codBlocked).toBe(false);

      const c = await getCustomer();
      expect(c.codBlocked).toBe(false);
      expect(c.codOverride).toBe(true);
      expect(c.codOverrideNote).toBe('Customer deposited GH₵50 and promised acceptance');
      expect(c.codOverrideById).toBe(ownerId);
      expect(c.codOverrideAt).toBeInstanceOf(Date);
      expect(c.refusedOrders).toBe(0);
      expect(c.riskLevel).toBe('normal');
      expect(customerNeedsManualCall(c)).toBe(false);
    });

    it("after override allow=true, customer's next new order gets requiresManualCall=false", async () => {
      const newOrder = await runInTenant(tenantId, () =>
        orderService.createOrder({
          customerId,
          orderItems: [{ productId, quantity: 1, unitPrice: 100 }],
          totalAmount: 100,
          deliveryAddress: '10 High Street',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
        })
      );

      expect(newOrder.requiresManualCall).toBe(false);
    });

    it('manager can also turn COD off again (allow=false)', async () => {
      const res = await request(app)
        .post(`/api/customers/${customerId}/cod-override`)
        .set(bearer(managerToken))
        .send({ allow: false, note: 'Turned off by manager due to suspicious activity' });

      expect(res.status).toBe(200);
      expect(res.body.customer.codBlocked).toBe(true);

      const c = await getCustomer();
      expect(c.codBlocked).toBe(true);
      expect(c.codOverride).toBe(false);
      expect(c.codOverrideNote).toBe('Turned off by manager due to suspicious activity');
      expect(c.refusedOrders).toBe(0);
      expect(c.riskLevel).toBe('normal');
      expect(customerNeedsManualCall(c)).toBe(true);
    });

    it('override allow=false on customer with past refusals restarts refusal count to 0 and keeps blocked true', async () => {
      await prismaBase.customer.update({
        where: { id: customerId },
        data: { codOverride: false, codOverrideAt: null, codBlocked: true, refusedOrders: 3, riskLevel: 'high' },
      });

      const res = await request(app)
        .post(`/api/customers/${customerId}/cod-override`)
        .set(bearer(managerToken))
        .send({ allow: false, note: 'Manual lock while having refusals' });

      expect(res.status).toBe(200);
      expect(res.body.customer.codBlocked).toBe(true);

      const c = await getCustomer();
      expect(c.codBlocked).toBe(true);
      expect(c.codOverride).toBe(false);
      expect(c.refusedOrders).toBe(0);
      expect(c.riskLevel).toBe('normal');
      expect(customerNeedsManualCall(c)).toBe(true);
    });
  });

  describe('idempotence and corrections', () => {
    it('correction: returned -> delivered moves count and lifts block when refusals decrease', async () => {
      // First, set customer back to 3 refusals with no override
      await prismaBase.customer.update({
        where: { id: customerId },
        data: { codOverride: false, codOverrideAt: null, codOverrideNote: null, codBlocked: true },
      });

      // Customer has orders 1, 2, 3 as refused
      const beforeCorr = await getCustomer();
      expect(beforeCorr.codBlocked).toBe(true);

      // Now correct order 3: from returned to delivered
      await runInTenant(tenantId, () =>
        transitionOrder(order3Id, 'delivered', adminActor(), { force: true, reason: 'Correction: delivered' })
      );

      const afterCorr = await until((x) => x.deliveredOrders === 1 && x.refusedOrders === 2);
      expect(afterCorr.deliveredOrders).toBe(1);
      expect(afterCorr.refusedOrders).toBe(2);
      expect(afterCorr.riskLevel).toBe('high');
      // Block is lifted because refusedOrders dropped to 2!
      expect(afterCorr.codBlocked).toBe(false);

      // Moving again to delivered is idempotent
      await runInTenant(tenantId, () =>
        transitionOrder(order3Id, 'delivered', adminActor())
      );
      const afterRepeat = await getCustomer();
      expect(afterRepeat.deliveredOrders).toBe(1);
      expect(afterRepeat.refusedOrders).toBe(2);
    });
  });
});
