/**
 * M7-T03 (COD-63, F-324, F-757, F-758, F-755): Call outcome service rules.
 * - Confirmed: sets confirmedAt and status confirmed; on an already confirmed order it is rejected with 409.
 * - Declined needs a reason and cancels the order with declineReason.
 * - Wrong number cancels with reason "wrong number" and sets Customer.wrongNumber.
 * - Not reachable keeps pending_confirmation and logs the call.
 * - Call back in the past is rejected with 400.
 * - A rep cannot log a call on another rep's order (403).
 * - auto_confirm calls never set firstContactAt; first rep call sets firstContactAt.
 * - Response includes next queue order id.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';

jest.mock('../../services/workflowService', () => ({
  __esModule: true,
  default: { triggerStatusChangeWorkflows: () => Promise.resolve() },
  registerWorkflowListeners: jest.fn(),
}));

const SUFFIX = Date.now();
let tenantId: string;
let customerId: number;
let rep1Token: string;
let rep1Id: number;
let rep2Token: string;
let rep2Id: number;
let adminToken: string;
let adminId: number;

const tenantIds: string[] = [];

async function setupTenant(label: string) {
  tenantId = (await createTenant(label)).id;
  tenantIds.push(tenantId);
  await seedTenantDefaults(tenantId);

  const customer = await prismaBase.customer.create({
    data: {
      firstName: 'Yaw',
      lastName: 'Boateng',
      phoneNumber: `+2332${String(SUFFIX).slice(-7)}1`,
      address: '15 Ring Rd',
      state: 'Greater Accra',
      area: 'Accra',
      tenantId,
    },
  });
  customerId = customer.id;

  const makeUser = async (name: string, role: string) => {
    const user = await prismaBase.user.create({
      data: {
        email: `${name}-${tenantIds.length}-${SUFFIX}@codadmin.test`,
        password: 'hash',
        firstName: name,
        lastName: 'Test',
        role,
        tenantId,
      } as any,
    });
    const { generateAccessToken } = await import('../../utils/jwt');
    const token = generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId,
    });
    return { id: user.id, token };
  };

  const rep1 = await makeUser('rep1', 'sales_rep');
  rep1Id = rep1.id;
  rep1Token = rep1.token;

  const rep2 = await makeUser('rep2', 'sales_rep');
  rep2Id = rep2.id;
  rep2Token = rep2.token;

  const admin = await makeUser('admin', 'super_admin');
  adminId = admin.id;
  adminToken = admin.token;
}

beforeAll(() => setupTenant('Call Outcome Tenant'), 30000);

afterAll(async () => {
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});

describe('M7-T03: Call outcome service rules', () => {
  it('confirmed sets confirmedAt, confirmedById, status confirmed; already confirmed order returns 409', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 150,
        totalAmount: 150,
        codAmount: 150,
        customerRepId: rep1Id,
        tenantId,
      } as any,
    });

    // Rep1 logs confirmed call
    const res = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${rep1Token}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'confirmed',
        notes: 'Customer confirmed order',
      });

    expect(res.status).toBe(201);
    expect(res.body.call.outcome).toBe('confirmed');

    // Order is now confirmed
    const updated = await prismaBase.order.findUnique({ where: { id: order.id } });
    expect(updated!.status).toBe('confirmed');
    expect(updated!.confirmedAt).not.toBeNull();
    expect(updated!.confirmedById).toBe(rep1Id);

    // Second confirm attempt on the already-confirmed order returns 409
    const res2 = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${rep1Token}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'confirmed',
        notes: 'Confirming again',
      });

    expect(res2.status).toBe(409);
  });

  it('declined requires a reason and cancels the order', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        customerRepId: rep1Id,
        tenantId,
      } as any,
    });

    // Missing declineReason returns 400
    const failRes = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${rep1Token}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'declined',
      });
    expect(failRes.status).toBe(400);

    // With declineReason cancels order
    const okRes = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${rep1Token}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'declined',
        declineReason: 'price_too_high',
        notes: 'Customer thought price was too high',
      });

    expect(okRes.status).toBe(201);
    const updated = await prismaBase.order.findUnique({ where: { id: order.id } });
    expect(updated!.status).toBe('cancelled');
    expect(updated!.declineReason).toBe('price_too_high');
  });

  it('wrong number cancels with reason wrong number and sets Customer.wrongNumber', async () => {
    const customer = await prismaBase.customer.create({
      data: {
        firstName: 'Wrong',
        lastName: 'Person',
        phoneNumber: `+2332${String(SUFFIX).slice(-7)}2`,
        address: '10 Nowhere',
        state: 'Greater Accra',
        area: 'Accra',
        tenantId,
      },
    });

    const order = await prismaBase.order.create({
      data: {
        customerId: customer.id,
        status: 'pending_confirmation',
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        customerRepId: rep1Id,
        tenantId,
      } as any,
    });

    const res = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${rep1Token}`)
      .send({
        customerId: customer.id,
        orderId: order.id,
        outcome: 'wrong_number',
      });

    expect(res.status).toBe(201);

    const updatedOrder = await prismaBase.order.findUnique({ where: { id: order.id } });
    expect(updatedOrder!.status).toBe('cancelled');
    expect(updatedOrder!.declineReason).toBe('wrong_number');

    const updatedCustomer = await prismaBase.customer.findUnique({ where: { id: customer.id } });
    expect(updatedCustomer!.wrongNumber).toBe(true);
  });

  it('not reachable keeps order in pending_confirmation and logs the call', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        customerRepId: rep1Id,
        tenantId,
      } as any,
    });

    const res = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${rep1Token}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'not_reachable',
        notes: 'Phone switched off',
      });

    expect(res.status).toBe(201);
    const updated = await prismaBase.order.findUnique({ where: { id: order.id } });
    expect(updated!.status).toBe('pending_confirmation');
  });

  it('call back in the past returns 400; valid call back stays pending_confirmation', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        customerRepId: rep1Id,
        tenantId,
      } as any,
    });

    // Past date returns 400
    const past = new Date(Date.now() - 3600_000).toISOString();
    const pastRes = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${rep1Token}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'call_back_later',
        callbackAt: past,
      });
    expect(pastRes.status).toBe(400);

    // Future date succeeds
    const future = new Date(Date.now() + 3600_000).toISOString();
    const futureRes = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${rep1Token}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'call_back_later',
        callbackAt: future,
      });
    expect(futureRes.status).toBe(201);

    const updated = await prismaBase.order.findUnique({ where: { id: order.id } });
    expect(updated!.status).toBe('pending_confirmation');
  });

  it('rep logging a call on another rep order returns 403; admin is allowed', async () => {
    // Order assigned to rep1
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        customerRepId: rep1Id,
        tenantId,
      } as any,
    });

    // Rep2 attempts to log call -> 403
    const forbiddenRes = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${rep2Token}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'not_reachable',
      });
    expect(forbiddenRes.status).toBe(403);

    // Admin is allowed on any order -> 201
    const adminRes = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'not_reachable',
      });
    expect(adminRes.status).toBe(201);
  });

  it('firstContactAt is set on the first rep call attempt only; auto_confirm calls never set it', async () => {
    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        customerRepId: rep1Id,
        firstContactAt: null,
        tenantId,
      } as any,
    });

    // auto_confirm call does NOT set firstContactAt
    await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'not_reachable',
        source: 'auto_confirm',
      });

    const afterAuto = await prismaBase.order.findUnique({ where: { id: order.id } });
    expect(afterAuto!.firstContactAt).toBeNull();

    // First rep call attempt DOES set firstContactAt
    await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${rep1Token}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'not_reachable',
        source: 'manual',
      });

    const afterFirst = await prismaBase.order.findUnique({ where: { id: order.id } });
    expect(afterFirst!.firstContactAt).not.toBeNull();
    const firstTime = afterFirst!.firstContactAt!.getTime();

    // Second rep call does NOT overwrite firstContactAt
    await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${rep1Token}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'not_reachable',
        source: 'manual',
      });

    const afterSecond = await prismaBase.order.findUnique({ where: { id: order.id } });
    expect(afterSecond!.firstContactAt!.getTime()).toBe(firstTime);
  });

  it('response includes next queue order id for the rep', async () => {
    // Create two orders for rep1
    const order1 = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        customerRepId: rep1Id,
        priority: 10,
        tenantId,
      } as any,
    });

    const order2 = await prismaBase.order.create({
      data: {
        customerId,
        status: 'pending_confirmation',
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        customerRepId: rep1Id,
        priority: 5,
        tenantId,
      } as any,
    });

    // Call on order1: next order in queue should be order2
    const res = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${rep1Token}`)
      .send({
        customerId,
        orderId: order1.id,
        outcome: 'confirmed',
      });

    expect(res.status).toBe(201);
    expect(res.body.nextOrderId).toBe(order2.id);
  });

  it('F2: a transition that fails leaves no call row and no upsell line', async () => {
    const product = await prismaBase.product.create({
      data: {
        name: 'Item F2',
        sku: `ITEM-F2-${Date.now()}`,
        category: 'General',
        price: 100,
        cogs: 50,
        stockQuantity: 10,
        tenantId,
      },
    });
    const form = await prismaBase.checkoutForm.create({
      data: {
        name: 'Form F2',
        slug: `form-f2-${Date.now()}`,
        productId: product.id,
        fields: {},
        styling: {},
        regions: {},
        tenantId,
      },
    });
    const pkg = await prismaBase.formPackage.create({
      data: { formId: form.id, name: 'Pkg 2', price: 200, quantity: 2 },
    });

    const order = await prismaBase.order.create({
      data: {
        customerId,
        status: 'delivered',
        subtotal: 100,
        totalAmount: 100,
        codAmount: 100,
        customerRepId: rep1Id,
        tenantId,
      } as any,
    });

    const res = await request(app)
      .post('/api/calls')
      .set('Authorization', `Bearer ${rep1Token}`)
      .send({
        customerId,
        orderId: order.id,
        outcome: 'confirmed',
        orderChanges: { packageId: pkg.id },
      });

    expect(res.status).toBe(409);

    const callCount = await prismaBase.call.count({ where: { orderId: order.id } });
    expect(callCount).toBe(0);

    const upsellLineCount = await prismaBase.upsellLine.count({ where: { orderId: order.id } });
    expect(upsellLineCount).toBe(0);
  });

  describe('F3: outcome aliases (rescheduled, no_answer, cancelled)', () => {
    it('maps rescheduled to call_back_later and enforces future callbackAt', async () => {
      const order = await prismaBase.order.create({
        data: {
          customerId,
          status: 'pending_confirmation',
          subtotal: 100,
          totalAmount: 100,
          codAmount: 100,
          customerRepId: rep1Id,
          tenantId,
        } as any,
      });

      // Without callbackAt -> 400
      const failRes = await request(app)
        .post('/api/calls')
        .set('Authorization', `Bearer ${rep1Token}`)
        .send({
          customerId,
          orderId: order.id,
          outcome: 'rescheduled',
        });
      expect(failRes.status).toBe(400);

      // With future callbackAt -> 201 and mapped to call_back_later
      const futureDate = new Date(Date.now() + 3600_000).toISOString();
      const res = await request(app)
        .post('/api/calls')
        .set('Authorization', `Bearer ${rep1Token}`)
        .send({
          customerId,
          orderId: order.id,
          outcome: 'rescheduled',
          callbackAt: futureDate,
        });
      expect(res.status).toBe(201);
      expect(res.body.call.outcome).toBe('call_back_later');

      const callInDb = await prismaBase.call.findUnique({ where: { id: res.body.call.id } });
      expect(callInDb!.outcome).toBe('call_back_later');
    });

    it('maps no_answer to not_reachable and keeps order in pending_confirmation', async () => {
      const order = await prismaBase.order.create({
        data: {
          customerId,
          status: 'pending_confirmation',
          subtotal: 100,
          totalAmount: 100,
          codAmount: 100,
          customerRepId: rep1Id,
          tenantId,
        } as any,
      });

      const res = await request(app)
        .post('/api/calls')
        .set('Authorization', `Bearer ${rep1Token}`)
        .send({
          customerId,
          orderId: order.id,
          outcome: 'no_answer',
        });
      expect(res.status).toBe(201);
      expect(res.body.call.outcome).toBe('not_reachable');

      const callInDb = await prismaBase.call.findUnique({ where: { id: res.body.call.id } });
      expect(callInDb!.outcome).toBe('not_reachable');

      const orderInDb = await prismaBase.order.findUnique({ where: { id: order.id } });
      expect(orderInDb!.status).toBe('pending_confirmation');
    });

    it('maps cancelled to declined, requires declineReason, and cancels order', async () => {
      const order = await prismaBase.order.create({
        data: {
          customerId,
          status: 'pending_confirmation',
          subtotal: 100,
          totalAmount: 100,
          codAmount: 100,
          customerRepId: rep1Id,
          tenantId,
        } as any,
      });

      // Without declineReason -> 400
      const failRes = await request(app)
        .post('/api/calls')
        .set('Authorization', `Bearer ${rep1Token}`)
        .send({
          customerId,
          orderId: order.id,
          outcome: 'cancelled',
        });
      expect(failRes.status).toBe(400);

      // With declineReason -> 201, mapped to declined, cancels order
      const res = await request(app)
        .post('/api/calls')
        .set('Authorization', `Bearer ${rep1Token}`)
        .send({
          customerId,
          orderId: order.id,
          outcome: 'cancelled',
          declineReason: 'changed_mind',
        });
      expect(res.status).toBe(201);
      expect(res.body.call.outcome).toBe('declined');

      const callInDb = await prismaBase.call.findUnique({ where: { id: res.body.call.id } });
      expect(callInDb!.outcome).toBe('declined');

      const orderInDb = await prismaBase.order.findUnique({ where: { id: order.id } });
      expect(orderInDb!.status).toBe('cancelled');
      expect(orderInDb!.declineReason).toBe('changed_mind');
    });
  });
});
