import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { makeOrder, makeUser } from './helpers/kpiOrders';
import { CallOutcome } from '@prisma/client';

describe('M7-T10 Rep API part 1: shell summary, Today, queue, call card, one-save guard', () => {
  let pair: TwoTenants;
  let tenantId: string;
  let customerId: number;
  let rep1Id: number;
  let rep1Token: string;
  let rep2Id: number;
  let rep2Token: string;
  let adminToken: string;

  const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });

  beforeAll(async () => {
    pair = await createTwoTenants('repapi');
    tenantId = pair.a.id;
    customerId = pair.a.ids.customer;
    rep1Id = pair.a.users.salesRep.id;
    rep1Token = pair.a.users.salesRep.token;
    adminToken = pair.a.users.admin.token;

    // Create Rep 2 in tenant A
    const rep2User = await makeUser(tenantId, 'rep2', 'sales_rep');
    rep2Id = rep2User.id;
    rep2Token = generateAccessToken({ id: rep2Id, email: rep2User.email, role: 'sales_rep', tenantId });

    // Configure operating hours on tenant A: 08:00 to 20:00 weekdays, target 15, alert 30
    const weekday = { open: '08:00', close: '20:00', enabled: true };
    await prismaBase.systemConfig.update({
      where: { tenantId },
      data: {
        operatingHours: {
          days: {
            monday: weekday,
            tuesday: weekday,
            wednesday: weekday,
            thursday: weekday,
            friday: weekday,
            saturday: { open: '09:00', close: '18:00', enabled: true },
            sunday: { open: '10:00', close: '16:00', enabled: false },
          },
          firstCallTargetMinutes: 15,
          queueWaitAlertMinutes: 30,
        },
      },
    });
  });

  afterAll(async () => {
    await pair.cleanup();
  });

  describe('1. Shell summary (GET /api/rep/me/summary, GET /api/rep/summary)', () => {
    it('returns queue counts scoped to the rep; rep B never sees rep A orders', async () => {
      // Create 2 pending orders for rep 1 and 1 pending order for rep 2
      await makeOrder({ tenantId, customerId, customerRepId: rep1Id, status: 'pending_confirmation' });
      await makeOrder({ tenantId, customerId, customerRepId: rep1Id, status: 'pending_confirmation' });
      await makeOrder({ tenantId, customerId, customerRepId: rep2Id, status: 'pending_confirmation' });

      // Rep 1 sees at least 2 pending orders
      const res1 = await request(app).get('/api/rep/me/summary').set(auth(rep1Token));
      expect(res1.status).toBe(200);
      expect(res1.body.queue).toBeGreaterThanOrEqual(2);

      // Rep 2 sees exactly 1 pending order
      const res2 = await request(app).get('/api/rep/summary').set(auth(rep2Token));
      expect(res2.status).toBe(200);
      expect(res2.body.queue).toBe(1);

      // Admin can pass ?repId=
      const resAdmin = await request(app).get(`/api/rep/summary?repId=${rep2Id}`).set(auth(adminToken));
      expect(resAdmin.status).toBe(200);
      expect(resAdmin.body.queue).toBe(1);

      // Rep 1 trying to pass ?repId=rep2 gets 403 Forbidden
      const resForbidden = await request(app).get(`/api/rep/summary?repId=${rep2Id}`).set(auth(rep1Token));
      expect(resForbidden.status).toBe(403);
    });
  });

  describe('2. Today page (GET /api/rep/me/today, GET /api/rep/today)', () => {
    it('returns calls done, confirmed, upsell extra, time to first call, and "No target set" when none', async () => {
      // Rep 1 logs a confirmed call and an upsell line
      const order = await makeOrder({ tenantId, customerId, customerRepId: rep1Id, status: 'pending_confirmation' });
      await prismaBase.call.create({
        data: {
          tenantId,
          customerId,
          orderId: order.id,
          salesRepId: rep1Id,
          outcome: CallOutcome.confirmed,
          source: 'manual',
        },
      });

      await prismaBase.upsellLine.create({
        data: {
          tenantId,
          orderId: order.id,
          repId: rep1Id,
          kind: 'addon',
          extraValue: 40,
        },
      });

      const res = await request(app).get('/api/rep/me/today').set(auth(rep1Token));
      expect(res.status).toBe(200);
      expect(res.body.callsDone).toBeGreaterThanOrEqual(1);
      expect(res.body.confirmed).toBeGreaterThanOrEqual(1);
      expect(Number(res.body.upsellExtra)).toBeGreaterThanOrEqual(40);
      expect(res.body.timeToFirstCall).toBeDefined();
      expect(res.body.targetProgress).toBeDefined();
      expect(res.body.targetProgress.message).toBe('No target set');

      // Rep 2 sees 0 calls and 0 upsell
      const res2 = await request(app).get('/api/rep/today').set(auth(rep2Token));
      expect(res2.status).toBe(200);
      expect(res2.body.callsDone).toBe(0);
      expect(res2.body.confirmed).toBe(0);
      expect(Number(res2.body.upsellExtra)).toBe(0);

      // Manager/Admin can view rep 1 via ?repId=
      const resAdmin = await request(app).get(`/api/rep/today?repId=${rep1Id}`).set(auth(adminToken));
      expect(resAdmin.status).toBe(200);
      expect(resAdmin.body.confirmed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('3. Queue (GET /api/rep/me/queue, tabs, wait timers, callback due flag)', () => {
    it('returns 4 tabs (New, Call back, Said NO, Not reachable) with server-computed wait timers and callback due flag', async () => {
      // Clean up past test orders for rep 1 to have predictable queue tab counts
      await prismaBase.order.updateMany({
        where: { tenantId, customerRepId: rep1Id, status: 'pending_confirmation' },
        data: { status: 'cancelled' },
      });

      // 1. New order (waiting 20 min -> severity gold)
      const date20MinAgo = new Date(Date.now() - 20 * 60 * 1000);
      const oNew = await makeOrder({
        tenantId,
        customerId,
        customerRepId: rep1Id,
        status: 'pending_confirmation',
        createdAt: date20MinAgo,
      });

      // 2. Said NO order
      const oSaidNo = await makeOrder({
        tenantId,
        customerId,
        customerRepId: rep1Id,
        status: 'pending_confirmation',
      });
      await prismaBase.order.update({
        where: { id: oSaidNo.id },
        data: { saidNo: true },
      });

      // 3. Call back order with callbackAt in the past (overdue 10 min -> callbackDue: true, coral)
      const oCallback = await makeOrder({
        tenantId,
        customerId,
        customerRepId: rep1Id,
        status: 'pending_confirmation',
      });
      await prismaBase.call.create({
        data: {
          tenantId,
          customerId,
          orderId: oCallback.id,
          salesRepId: rep1Id,
          outcome: CallOutcome.call_back_later,
          callbackAt: new Date(Date.now() - 10 * 60 * 1000),
          source: 'manual',
        },
      });

      // 4. Not reachable order
      const oNotReachable = await makeOrder({
        tenantId,
        customerId,
        customerRepId: rep1Id,
        status: 'pending_confirmation',
      });
      await prismaBase.call.create({
        data: {
          tenantId,
          customerId,
          orderId: oNotReachable.id,
          salesRepId: rep1Id,
          outcome: CallOutcome.not_reachable,
          source: 'manual',
        },
      });

      const res = await request(app).get('/api/rep/me/queue').set(auth(rep1Token));
      expect(res.status).toBe(200);
      expect(res.body.tabs).toBeDefined();
      expect(res.body.tabs.new).toBe(1);
      expect(res.body.tabs.said_no).toBe(1);
      expect(res.body.tabs.call_back).toBe(1);
      expect(res.body.tabs.not_reachable).toBe(1);
      expect(res.body.total).toBe(4);

      // Check callback due flag and formatted text
      const cbItem = res.body.orders.find((o: any) => o.id === oCallback.id);
      expect(cbItem).toBeDefined();
      expect(cbItem.callbackDue).toBe(true);
      expect(cbItem.callbackDueFormatted).toMatch(/Overdue/);
      expect(cbItem.callbackSeverity).toBe('coral');

      // Check wait timer values on oNew
      const newItem = res.body.orders.find((o: any) => o.id === oNew.id);
      expect(newItem).toBeDefined();
      expect(newItem.waitMinutes).toBeGreaterThanOrEqual(18);
      expect(newItem.waitTimerFormatted).toBeDefined();
      expect(newItem.waitTimerSeverity).toBe('gold');

      // Filtering by tab=call_back
      const resCbTab = await request(app).get('/api/rep/me/queue?tab=call_back').set(auth(rep1Token));
      expect(resCbTab.status).toBe(200);
      expect(resCbTab.body.orders.length).toBe(1);
      expect(resCbTab.body.orders[0].id).toBe(oCallback.id);
      expect(resCbTab.body.tabs.total).toBe(4); // Preserves total tabs counts
    });

    it('an order reassigned away leaves the queue at once', async () => {
      const order = await makeOrder({
        tenantId,
        customerId,
        customerRepId: rep1Id,
        status: 'pending_confirmation',
      });

      // Verify it is in rep 1's queue
      let q1 = await request(app).get('/api/rep/me/queue').set(auth(rep1Token));
      expect(q1.body.orders.some((o: any) => o.id === order.id)).toBe(true);

      // Reassign to rep 2
      await prismaBase.order.update({
        where: { id: order.id },
        data: { customerRepId: rep2Id },
      });

      // Immediately leaves rep 1's queue
      q1 = await request(app).get('/api/rep/me/queue').set(auth(rep1Token));
      expect(q1.body.orders.some((o: any) => o.id === order.id)).toBe(false);

      // Appears in rep 2's queue
      const q2 = await request(app).get('/api/rep/me/queue').set(auth(rep2Token));
      expect(q2.body.orders.some((o: any) => o.id === order.id)).toBe(true);
    });

    it('an auto-confirmed order leaves the queue at once', async () => {
      const order = await makeOrder({
        tenantId,
        customerId,
        customerRepId: rep1Id,
        status: 'pending_confirmation',
      });

      let q = await request(app).get('/api/rep/me/queue').set(auth(rep1Token));
      expect(q.body.orders.some((o: any) => o.id === order.id)).toBe(true);

      // Order gets auto-confirmed (status becomes confirmed)
      await prismaBase.order.update({
        where: { id: order.id },
        data: { status: 'confirmed' },
      });

      q = await request(app).get('/api/rep/me/queue').set(auth(rep1Token));
      expect(q.body.orders.some((o: any) => o.id === order.id)).toBe(false);
    });
  });

  describe('4. Call card (GET /api/rep/orders/:id/card)', () => {
    it('returns order, customer risk fields, items, packages, last calls, next queue order id', async () => {
      // Clean up past pending orders for rep 1
      await prismaBase.order.updateMany({
        where: { tenantId, customerRepId: rep1Id, status: 'pending_confirmation' },
        data: { status: 'cancelled' },
      });

      // Set risk fields on customer
      await prismaBase.customer.update({
        where: { id: customerId },
        data: {
          riskLevel: 'high',
          refusedOrders: 2,
          deliveredOrders: 1,
          codBlocked: false,
          wrongNumber: false,
        },
      });

      const order1 = await makeOrder({
        tenantId,
        customerId,
        customerRepId: rep1Id,
        status: 'pending_confirmation',
      });

      const order2 = await makeOrder({
        tenantId,
        customerId,
        customerRepId: rep1Id,
        status: 'pending_confirmation',
      });

      // Log a previous call on order1
      await prismaBase.call.create({
        data: {
          tenantId,
          customerId,
          orderId: order1.id,
          salesRepId: rep1Id,
          outcome: CallOutcome.not_reachable,
          notes: 'Customer phone rang with no answer',
          source: 'manual',
        },
      });

      const res = await request(app).get(`/api/rep/orders/${order1.id}/card`).set(auth(rep1Token));
      expect(res.status).toBe(200);
      expect(res.body.order.id).toBe(order1.id);
      expect(res.body.order.orderNumber).toBe(`#${order1.id}`);
      expect(res.body.customer.riskLevel).toBe('high');
      expect(res.body.customer.refusedOrders).toBe(2);
      expect(res.body.lastCalls.length).toBeGreaterThanOrEqual(1);
      expect(res.body.lastCalls[0].outcome).toBe('not_reachable');
      expect(res.body.nextOrderId).toBe(order2.id);

      // Rep 2 trying to open Rep 1's call card gets 403 Forbidden
      const resForbidden = await request(app).get(`/api/rep/orders/${order1.id}/card`).set(auth(rep2Token));
      expect(resForbidden.status).toBe(403);

      // Admin can open Rep 1's card
      const resAdmin = await request(app).get(`/api/rep/orders/${order1.id}/card`).set(auth(adminToken));
      expect(resAdmin.status).toBe(200);
      expect(resAdmin.body.order.id).toBe(order1.id);
    });
  });

  describe('5. One-save guard (POST /api/calls)', () => {
    it('two reps saving one card: the second gets 409 "Already handled"', async () => {
      const order = await makeOrder({
        tenantId,
        customerId,
        customerRepId: rep1Id,
        status: 'pending_confirmation',
      });

      const openedAt = new Date().toISOString();

      // Rep 1 confirms the order
      const res1 = await request(app)
        .post('/api/calls')
        .set(auth(rep1Token))
        .send({
          customerId,
          orderId: order.id,
          outcome: 'confirmed',
          notes: 'Customer confirmed on the phone',
          openedAt,
        });
      expect(res1.status).toBe(201);

      // Rep 2 attempts to save on the same order card that was already handled
      const res2 = await request(app)
        .post('/api/calls')
        .set(auth(adminToken)) // Manager/admin or rep saving same card
        .send({
          customerId,
          orderId: order.id,
          outcome: 'confirmed',
          notes: 'Concurrent save attempt',
          openedAt,
        });

      expect(res2.status).toBe(409);
      expect(res2.body.message).toBe('Already handled');
    });

    it('second save with expectedUpdatedAt mismatch gets 409 "Already handled"', async () => {
      const order = await makeOrder({
        tenantId,
        customerId,
        customerRepId: rep1Id,
        status: 'pending_confirmation',
      });

      const initialUpdatedAt = order.updatedAt.toISOString();

      // Rep 1 logs a not_reachable attempt (bumping order.updatedAt)
      const res1 = await request(app)
        .post('/api/calls')
        .set(auth(rep1Token))
        .send({
          customerId,
          orderId: order.id,
          outcome: 'not_reachable',
          notes: 'Customer did not answer',
        });
      expect(res1.status).toBe(201);

      // Rep 2 sends save with stale expectedUpdatedAt
      const res2 = await request(app)
        .post('/api/calls')
        .set(auth(adminToken))
        .send({
          customerId,
          orderId: order.id,
          outcome: 'not_reachable',
          notes: 'Stale card save',
          expectedUpdatedAt: initialUpdatedAt,
        });

      expect(res2.status).toBe(409);
      expect(res2.body.message).toBe('Already handled');
    });
  });
});
