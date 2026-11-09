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

describe('M7-T10 Rep API part 1: summary, Today, queue, call card, one-save guard', () => {
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

    // Configure operating hours on tenant A: 00:00 to 23:59 (24/7 so tests pass at any hour), target 15, alert 30
    const weekday = { open: '00:00', close: '23:59', enabled: true };
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
            saturday: weekday,
            sunday: weekday,
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

  describe('1. Shell summary (GET /api/rep/summary)', () => {
    it('returns queue counts scoped to the rep; rep B never sees rep A orders; one field per value', async () => {
      // Create 2 pending orders for rep 1 and 1 pending order for rep 2
      await makeOrder({ tenantId, customerId, customerRepId: rep1Id, status: 'pending_confirmation' });
      await makeOrder({ tenantId, customerId, customerRepId: rep1Id, status: 'pending_confirmation' });
      await makeOrder({ tenantId, customerId, customerRepId: rep2Id, status: 'pending_confirmation' });

      // Rep 1 sees at least 2 pending orders
      const res1 = await request(app).get('/api/rep/summary').set(auth(rep1Token));
      expect(res1.status).toBe(200);
      expect(res1.body.queue).toBeGreaterThanOrEqual(2);
      expect(res1.body.inbox).toBeDefined();
      expect(res1.body.todayConfirmed).toBeDefined();
      // One field per value: aliases removed
      expect(res1.body.pending).toBeUndefined();
      expect(res1.body.queueCount).toBeUndefined();
      expect(res1.body.unreadInbox).toBeUndefined();

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

    it('bad repId gives 400 for a rep', async () => {
      const res1 = await request(app).get('/api/rep/summary?repId=bad').set(auth(rep1Token));
      expect(res1.status).toBe(400);

      const res2 = await request(app).get('/api/rep/summary?repId=-5').set(auth(rep1Token));
      expect(res2.status).toBe(400);

      const res3 = await request(app).get('/api/rep/summary?repId=0').set(auth(rep1Token));
      expect(res3.status).toBe(400);
    });
  });

  describe('2. Today page (GET /api/rep/today)', () => {
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

      const res = await request(app).get('/api/rep/today').set(auth(rep1Token));
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

  describe('3. Queue (GET /api/rep/queue, tabs, wait timers, callback due flag)', () => {
    it('returns 4 tabs (New, Call back, Said NO, Not reachable) with numeric wait timers, minutes values, and no formatting', async () => {
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
        totalAmount: 150,
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

      const res = await request(app).get('/api/rep/queue').set(auth(rep1Token));
      expect(res.status).toBe(200);
      expect(res.body.tabs).toBeDefined();
      expect(res.body.tabs.new).toBe(1);
      expect(res.body.tabs.said_no).toBe(1);
      expect(res.body.tabs.call_back).toBe(1);
      expect(res.body.tabs.not_reachable).toBe(1);
      expect(res.body.total).toBe(4);
      // Added minute values and removed counts alias
      expect(res.body.firstCallTargetMinutes).toBe(15);
      expect(res.body.queueWaitAlertMinutes).toBe(30);
      expect(res.body.counts).toBeUndefined();

      // Check callback item: raw numbers and flags, no server-formatted strings
      const cbItem = res.body.orders.find((o: any) => o.id === oCallback.id);
      expect(cbItem).toBeDefined();
      expect(cbItem.callbackDue).toBe(true);
      expect(cbItem.callbackDueFormatted).toBeUndefined();
      expect(cbItem.orderNumber).toBeUndefined();
      expect(cbItem.callbackSeverity).toBe('coral');

      // Check wait timer values on oNew: no waitTimerFormatted, totalAmount is string via Money.toApi
      const newItem = res.body.orders.find((o: any) => o.id === oNew.id);
      expect(newItem).toBeDefined();
      expect(newItem.waitMinutes).toBeGreaterThanOrEqual(18);
      expect(newItem.waitTimerFormatted).toBeUndefined();
      expect(newItem.waitTimerSeverity).toBe('gold');
      expect(typeof newItem.totalAmount).toBe('string');

      // Filtering by tab=call_back
      const resCbTab = await request(app).get('/api/rep/queue?tab=call_back').set(auth(rep1Token));
      expect(resCbTab.status).toBe(200);
      expect(resCbTab.body.orders.length).toBe(1);
      expect(resCbTab.body.orders[0].id).toBe(oCallback.id);
      expect(resCbTab.body.tabs.total).toBe(4); // Preserves total tabs counts
    });

    it('bad tab returns 400', async () => {
      // Alias spellings like callback or saidno are rejected with 400
      const resAlias = await request(app).get('/api/rep/queue?tab=callback').set(auth(rep1Token));
      expect(resAlias.status).toBe(400);

      const resSaidNo = await request(app).get('/api/rep/queue?tab=saidno').set(auth(rep1Token));
      expect(resSaidNo.status).toBe(400);

      const resInvalid = await request(app).get('/api/rep/queue?tab=invalid_tab').set(auth(rep1Token));
      expect(resInvalid.status).toBe(400);
    });

    it('an order reassigned away leaves the queue at once', async () => {
      const order = await makeOrder({
        tenantId,
        customerId,
        customerRepId: rep1Id,
        status: 'pending_confirmation',
      });

      // Verify it is in rep 1's queue
      let q1 = await request(app).get('/api/rep/queue').set(auth(rep1Token));
      expect(q1.body.orders.some((o: any) => o.id === order.id)).toBe(true);

      // Reassign to rep 2
      await prismaBase.order.update({
        where: { id: order.id },
        data: { customerRepId: rep2Id },
      });

      // Immediately leaves rep 1's queue
      q1 = await request(app).get('/api/rep/queue').set(auth(rep1Token));
      expect(q1.body.orders.some((o: any) => o.id === order.id)).toBe(false);

      // Appears in rep 2's queue
      const q2 = await request(app).get('/api/rep/queue').set(auth(rep2Token));
      expect(q2.body.orders.some((o: any) => o.id === order.id)).toBe(true);
    });

    it('an auto-confirmed order leaves the queue at once', async () => {
      const order = await makeOrder({
        tenantId,
        customerId,
        customerRepId: rep1Id,
        status: 'pending_confirmation',
      });

      let q = await request(app).get('/api/rep/queue').set(auth(rep1Token));
      expect(q.body.orders.some((o: any) => o.id === order.id)).toBe(true);

      // Order gets auto-confirmed (status becomes confirmed)
      await prismaBase.order.update({
        where: { id: order.id },
        data: { status: 'confirmed' },
      });

      q = await request(app).get('/api/rep/queue').set(auth(rep1Token));
      expect(q.body.orders.some((o: any) => o.id === order.id)).toBe(false);
    });
  });

  describe('4. Call card (GET /api/rep/orders/:id/card)', () => {
    it('returns order, customer risk fields, items, packages, last calls, next queue order id (without orderNumber, money as toApi)', async () => {
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
        totalAmount: 250,
      });

      await prismaBase.order.update({
        where: { id: order1.id },
        data: { deliveryFee: 15, subtotal: 235 },
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
      // orderNumber formatting stays in frontend
      expect(res.body.order.orderNumber).toBeUndefined();
      expect(typeof res.body.order.totalAmount).toBe('string');
      expect(typeof res.body.order.subtotal).toBe('string');
      expect(typeof res.body.order.deliveryFee).toBe('string');
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
    it('two saves on one card at the same time give one 201 and one 409 (Promise.all)', async () => {
      const order = await makeOrder({
        tenantId,
        customerId,
        customerRepId: rep1Id,
        status: 'pending_confirmation',
      });

      const initialUpdatedAt = order.updatedAt.toISOString();

      // Run two saves concurrently using Promise.all
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/calls')
          .set(auth(rep1Token))
          .send({
            customerId,
            orderId: order.id,
            outcome: 'confirmed',
            notes: 'Concurrent save attempt 1',
            expectedUpdatedAt: initialUpdatedAt,
          }),
        request(app)
          .post('/api/calls')
          .set(auth(rep1Token))
          .send({
            customerId,
            orderId: order.id,
            outcome: 'confirmed',
            notes: 'Concurrent save attempt 2',
            expectedUpdatedAt: initialUpdatedAt,
          }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([201, 409]);
      const conflictRes = res1.status === 409 ? res1 : res2;
      expect(conflictRes.body.message).toBe('Already handled');
    });

    it('second save with stale expectedUpdatedAt gives 409 "Already handled"', async () => {
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

    it('the order drawer can still log a call on a confirmed order (no expectedUpdatedAt)', async () => {
      const order = await makeOrder({ tenantId, customerId, customerRepId: rep1Id, status: 'confirmed' });
      const res = await request(app)
        .post('/api/calls')
        .set(auth(adminToken))
        .send({ customerId, orderId: order.id, outcome: 'not_reachable', notes: 'Delivery follow-up' });
      expect(res.status).toBe(201);
    });

    it('a call card save on an order confirmed meanwhile gives 409', async () => {
      const order = await makeOrder({ tenantId, customerId, customerRepId: rep1Id, status: 'confirmed' });
      const res = await request(app)
        .post('/api/calls')
        .set(auth(rep1Token))
        .send({ customerId, orderId: order.id, outcome: 'not_reachable', expectedUpdatedAt: order.updatedAt.toISOString() });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Already handled');
    });
  });
});
