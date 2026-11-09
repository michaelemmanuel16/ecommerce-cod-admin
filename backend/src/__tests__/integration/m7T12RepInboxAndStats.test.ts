/**
 * M7-T12 (COD-65): Calls stats, upsell leaderboard, rep inbox events.
 * - /api/calls/stats returns the five outcomes Confirmed, Not reachable, Call back later, Declined, Wrong number, plus "Other" for legacy rows.
 * - Upsell leaderboard tab in leaderboardService: rank reps by active UpsellLine extra value in the period; zero rows give an empty list.
 * - Rep inbox basic events via notificationService: late call-back (call-back time passed, order still open) and new assigned order.
 * - A rep's inbox list returns only their own rows (tested with two reps).
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { runInTenant } from '../../utils/tenantContext';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import * as leaderboardService from '../../services/leaderboardService';
import { notifyLateCallback, checkAndNotifyLateCallbacks } from '../../services/notificationService';
import assignmentService from '../../services/assignmentService';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const phone = (n: number) => `+23324${String(SUFFIX).slice(-6)}${String(n).padStart(2, '0')}`;

let tenantId: string;
let adminToken: string;
let rep1Token: string;
let rep2Token: string;
let adminId: number;
let rep1Id: number;
let rep2Id: number;
let customerId: number;
let productId: number;

beforeAll(async () => {
  const tenant = await createTenant('T12 Rep Inbox Stats Tenant');
  tenantId = tenant.id;
  await seedTenantDefaults(tenantId);

  const admin = await prismaBase.user.create({
    data: {
      email: `admin-${SUFFIX}@t12.test`,
      password: 'x',
      firstName: 'Admin',
      lastName: 'User',
      role: 'admin',
      tenantId,
    },
  });
  adminId = admin.id;
  adminToken = generateAccessToken({ id: admin.id, email: admin.email, role: 'admin', tenantId });

  const rep1 = await prismaBase.user.create({
    data: {
      email: `rep1-${SUFFIX}@t12.test`,
      password: 'x',
      firstName: 'Kofi',
      lastName: 'Mensah',
      role: 'sales_rep',
      kind: 'person',
      tenantId,
    },
  });
  rep1Id = rep1.id;
  rep1Token = generateAccessToken({ id: rep1.id, email: rep1.email, role: 'sales_rep', tenantId });

  const rep2 = await prismaBase.user.create({
    data: {
      email: `rep2-${SUFFIX}@t12.test`,
      password: 'x',
      firstName: 'Ama',
      lastName: 'Osei',
      role: 'sales_rep',
      kind: 'person',
      tenantId,
    },
  });
  rep2Id = rep2.id;
  rep2Token = generateAccessToken({ id: rep2.id, email: rep2.email, role: 'sales_rep', tenantId });

  const product = await prismaBase.product.create({
    data: {
      name: 'T12 Test Product',
      sku: `PROD-T12-${SUFFIX}`,
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
      firstName: 'Kwame',
      lastName: 'Nkrumah',
      phoneNumber: phone(1),
      address: 'Independence Ave',
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

describe('M7-T12 (COD-65): Calls stats, upsell leaderboard, rep inbox events', () => {
  describe('GET /api/calls/stats', () => {
    beforeAll(async () => {
      // Create call records with all 5 outcomes plus legacy/other
      const outcomes = [
        'confirmed',
        'not_reachable',
        'call_back_later',
        'declined',
        'wrong_number',
        'other',
      ] as const;

      for (const outcome of outcomes) {
        await prismaBase.call.create({
          data: {
            tenantId,
            customerId,
            salesRepId: rep1Id,
            outcome,
            declineReason: outcome === 'declined' ? 'changed_mind' : null,
            duration: 60,
          },
        });
      }
    });

    it('returns the five outcomes Confirmed, Not reachable, Call back later, Declined, Wrong number, plus Other', async () => {
      const res = await request(app)
        .get('/api/calls/stats')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.stats).toBeDefined();

      const rep1Stats = res.body.stats.find((s: any) => s.repId === rep1Id);
      expect(rep1Stats).toBeDefined();
      expect(rep1Stats.outcomeBreakdown).toMatchObject({
        confirmed: expect.any(Number),
        not_reachable: expect.any(Number),
        call_back_later: expect.any(Number),
        declined: expect.any(Number),
        wrong_number: expect.any(Number),
        other: expect.any(Number),
      });

      expect(rep1Stats.outcomeBreakdown.confirmed).toBeGreaterThanOrEqual(1);
      expect(rep1Stats.outcomeBreakdown.not_reachable).toBeGreaterThanOrEqual(1);
      expect(rep1Stats.outcomeBreakdown.call_back_later).toBeGreaterThanOrEqual(1);
      expect(rep1Stats.outcomeBreakdown.declined).toBeGreaterThanOrEqual(1);
      expect(rep1Stats.outcomeBreakdown.wrong_number).toBeGreaterThanOrEqual(1);
      expect(rep1Stats.outcomeBreakdown.other).toBeGreaterThanOrEqual(1);

      if (res.body.outcomes) {
        expect(res.body.outcomes).toMatchObject({
          confirmed: expect.any(Number),
          not_reachable: expect.any(Number),
          call_back_later: expect.any(Number),
          declined: expect.any(Number),
          wrong_number: expect.any(Number),
          other: expect.any(Number),
        });
      }
    });
  });

  describe('Upsell leaderboard tab in leaderboardService', () => {
    it('zero rows give an empty list when no active UpsellLines exist in period', async () => {
      const res = await request(app)
        .get('/api/leaderboard?role=upsell&period=month')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.role).toBe('upsell');
      expect(res.body.rows).toEqual([]);
    });

    it('ranks reps by active UpsellLine extra value in the period; non-managers see only own row', async () => {
      // Create orders for Rep 1 and Rep 2
      const order1 = await prismaBase.order.create({
        data: {
          tenantId,
          customerId,
          status: 'pending_confirmation',
          subtotal: 100,
          totalAmount: 100,
          codAmount: 100,
          deliveryAddress: 'Accra',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
        },
      });

      const order2 = await prismaBase.order.create({
        data: {
          tenantId,
          customerId,
          status: 'pending_confirmation',
          subtotal: 100,
          totalAmount: 100,
          codAmount: 100,
          deliveryAddress: 'Accra',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
        },
      });

      // Rep 1 adds 150 extra value
      await prismaBase.upsellLine.create({
        data: {
          tenantId,
          orderId: order1.id,
          repId: rep1Id,
          kind: 'package',
          extraValue: 150,
          status: 'active',
        },
      });

      // Rep 2 adds 300 extra value
      await prismaBase.upsellLine.create({
        data: {
          tenantId,
          orderId: order2.id,
          repId: rep2Id,
          kind: 'addon',
          extraValue: 300,
          status: 'active',
        },
      });

      // Void upsell line should not be counted
      await prismaBase.upsellLine.create({
        data: {
          tenantId,
          orderId: order1.id,
          repId: rep1Id,
          kind: 'addon',
          extraValue: 500,
          status: 'void',
        },
      });

      // Admin query: sees both reps, ranked descending by active extra value
      const adminRes = await request(app)
        .get('/api/leaderboard?role=upsell&period=month')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(adminRes.status).toBe(200);
      expect(adminRes.body.rows.length).toBe(2);

      // Rank 1: Rep 2 (extraValue 300)
      expect(adminRes.body.rows[0].userId).toBe(rep2Id);
      expect(adminRes.body.rows[0].rank).toBe(1);
      expect(Number(adminRes.body.rows[0].actual)).toBe(300);

      // Rank 2: Rep 1 (extraValue 150)
      expect(adminRes.body.rows[1].userId).toBe(rep1Id);
      expect(adminRes.body.rows[1].rank).toBe(2);
      expect(Number(adminRes.body.rows[1].actual)).toBe(150);

      // Rep 1 query: sees ONLY Rep 1's row
      const rep1Res = await request(app)
        .get('/api/leaderboard?role=upsell&period=month')
        .set('Authorization', `Bearer ${rep1Token}`);

      expect(rep1Res.status).toBe(200);
      expect(rep1Res.body.rows.length).toBe(1);
      expect(rep1Res.body.rows[0].userId).toBe(rep1Id);
      expect(rep1Res.body.rows[0].rank).toBe(2);
    });
  });

  describe('Rep inbox basic events and isolation', () => {
    let orderA: any;
    let orderB: any;

    beforeAll(async () => {
      orderA = await prismaBase.order.create({
        data: {
          tenantId,
          customerId,
          status: 'pending_confirmation',
          subtotal: 100,
          totalAmount: 100,
          deliveryAddress: 'Accra',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
        },
      });

      orderB = await prismaBase.order.create({
        data: {
          tenantId,
          customerId,
          status: 'pending_confirmation',
          subtotal: 100,
          totalAmount: 100,
          deliveryAddress: 'Accra',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
        },
      });
    });

    it('new assigned order sends inbox notification to the assigned rep', async () => {
      await runInTenant(tenantId, () =>
        assignmentService.assignByRole(orderA.id, rep1Id, 'sales_rep', { kind: 'user', userId: adminId })
      );

      const notif = await prismaBase.notification.findFirst({
        where: { userId: rep1Id, type: 'order_assigned' },
      });
      expect(notif).toBeDefined();
      expect(notif?.title).toBe('New Order Assigned');
      expect((notif?.data as any)?.orderId).toBe(orderA.id);
    });

    it('late call-back creates a notification for rep when call-back time passed and order still open', async () => {
      const pastCallback = new Date(Date.now() - 3600_000); // 1 hour ago

      // Log a call with call_back_later in the past for rep 2 on open order B
      await prismaBase.call.create({
        data: {
          tenantId,
          customerId,
          orderId: orderB.id,
          salesRepId: rep2Id,
          outcome: 'call_back_later',
          callbackAt: pastCallback,
        },
      });

      // Run checkAndNotifyLateCallbacks
      const count = await runInTenant(tenantId, () => checkAndNotifyLateCallbacks(tenantId));
      expect(count).toBeGreaterThanOrEqual(1);

      const notif = await prismaBase.notification.findFirst({
        where: { userId: rep2Id, type: 'late_callback' },
      });
      expect(notif).toBeDefined();
      expect(notif?.title).toBe('Late Call-Back');
      expect((notif?.data as any)?.orderId).toBe(orderB.id);
    });

    it('a reps inbox list returns only their own rows (tested with two reps)', async () => {
      // Rep 1 inbox via /api/inbox
      const rep1Inbox = await request(app)
        .get('/api/inbox')
        .set('Authorization', `Bearer ${rep1Token}`);

      expect(rep1Inbox.status).toBe(200);
      expect(rep1Inbox.body.notifications).toBeDefined();
      expect(rep1Inbox.body.notifications.length).toBeGreaterThan(0);
      // Every single row belongs to rep1
      expect(rep1Inbox.body.notifications.every((n: any) => n.userId === rep1Id)).toBe(true);

      // Rep 2 inbox via /api/notifications
      const rep2Inbox = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${rep2Token}`);

      expect(rep2Inbox.status).toBe(200);
      expect(rep2Inbox.body.notifications).toBeDefined();
      expect(rep2Inbox.body.notifications.length).toBeGreaterThan(0);
      // Every single row belongs to rep2
      expect(rep2Inbox.body.notifications.every((n: any) => n.userId === rep2Id)).toBe(true);

      // Rep 1 does not see Rep 2's notifications
      const rep1Ids = new Set(rep1Inbox.body.notifications.map((n: any) => n.id));
      const rep2Ids = new Set(rep2Inbox.body.notifications.map((n: any) => n.id));
      for (const id of rep1Ids) {
        expect(rep2Ids.has(id)).toBe(false);
      }
    });
  });
});
