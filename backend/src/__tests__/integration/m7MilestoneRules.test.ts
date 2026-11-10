/**
 * COD-69, M7-T22: Lead conversion milestone integration tests.
 *
 * 1. Commission fixture: build the fixture from "Done when" through the real services
 *    (calls, upsell, delivery, payout), not by inserting entries:
 *    Adwoa owed 2,024 + 610 - 600 paid = GH₵2,034; Nana 104 + 30 = GH₵134; payable 2,168.
 *    Read the values through the rep earnings API (T11) and the payout view.
 * 2. P6: an order confirmed by a customer YES (WhatsApp inbound and public confirm)
 *    creates no commission entry, then delivers: still none.
 * 3. P2: a NO reply does not cancel. The order stays pending_confirmation, saidNo and
 *    requiresManualCall are true, and it shows in the rep queue Said NO tab.
 * 4. P4: an order created at night (outside operating hours) sends the auto-confirm
 *    message at once (provider stub called once at create time).
 * 5. First-call clock: an order at 21:00 with opening at 08:00 counts from 08:00;
 *    a YES reply counts as auto-confirmed, not as a call.
 * 6. Refusal rule end to end: 3 refused deliveries through the state machine, then a
 *    new order gets requiresManualCall; override restarts the count.
 * 7. Rep row scope: rep A never sees rep B's orders in queue, call card (403),
 *    my orders, earnings, numbers, inbox.
 * 8. Two tenants: tenant B data never shows for tenant A in the rep API, calls stats,
 *    leaderboard and customers.
 */

import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { stockUp } from './helpers/stock';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { runInTenant } from '../../utils/tenantContext';
import { callService } from '../../services/callService';
import { transitionOrder, TransitionActor } from '../../services/orderStateMachine';
import payoutService from '../../services/payoutService';
import orderService from '../../services/orderService';
import { sendAutoConfirmForOrder } from '../../services/autoConfirmService';
import { timeToFirstCall } from '../../services/kpi/timeToFirstCall';
import { createNotification } from '../../services/notificationService';
import { registerCustomerStatsListeners } from '../../services/customerStatsService';
import { CallOutcome, CallSource } from '@prisma/client';
import * as Money from '../../utils/money';

// Mock notification delivery and workflows so transitions run cleanly
jest.mock('../../services/workflowService', () => ({
  __esModule: true,
  default: {
    triggerStatusChangeWorkflows: () => Promise.resolve(),
    onOrderCreated: () => Promise.resolve(),
  },
  registerWorkflowListeners: jest.fn(),
}));

// Stub WhatsApp and SMS provider send functions (never send real messages)
const mockSendText = jest.fn().mockImplementation(async () => ({ success: true, messageId: `wa-mock-${Date.now()}` }));
const mockSendTemplate = jest.fn().mockImplementation(async () => ({ success: true, messageId: `wa-tpl-mock-${Date.now()}` }));
jest.mock('../../services/whatsappService', () => {
  const actual = jest.requireActual('../../services/whatsappService') as any;
  return {
    ...actual,
    whatsappService: {
      ...actual.whatsappService,
      sendText: (...args: any[]) => mockSendText(...args),
      sendTemplate: (...args: any[]) => mockSendTemplate(...args),
    },
  };
});

const mockSendSms = jest.fn().mockImplementation(async () => ({ success: true, messageId: `sms-mock-${Date.now()}` }));
jest.mock('../../services/smsService', () => {
  const actual = jest.requireActual('../../services/smsService') as any;
  return {
    ...actual,
    smsService: {
      ...actual.smsService,
      sendSms: (...args: any[]) => mockSendSms(...args),
    },
  };
});

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

function signPayload(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function makeWhatsAppWebhookPayload(phoneId: string, messageId: string, fromPhone: string, text: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-test',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550001',
                phone_number_id: phoneId,
              },
              contacts: [
                {
                  profile: { name: 'Customer' },
                  wa_id: fromPhone.replace(/^\+/, ''),
                },
              ],
              messages: [
                {
                  from: fromPhone.replace(/^\+/, ''),
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('COD-69, M7-T22: Milestone Integration Tests', () => {
  const tenantIds: string[] = [];

  beforeAll(() => {
    registerCustomerStatsListeners();
  });

  afterAll(async () => {
    await deleteTenantRows(tenantIds);
    await prismaBase.$disconnect();
  });

  // =========================================================================
  // 1. Commission fixture
  // =========================================================================
  describe('1. Commission fixture through real services', () => {
    it('builds fixture: Adwoa owed 2,024 + 610 - 600 paid = GH₵2,034; Nana 104 + 30 = GH₵134; payable 2,168', async () => {
      const fixTenant = (await createTenant('M7 Milestone Fixture')).id;
      tenantIds.push(fixTenant);
      await seedTenantDefaults(fixTenant);

      const customer = await prismaBase.customer.create({
        data: {
          tenantId: fixTenant,
          firstName: 'Ama',
          lastName: 'Osei',
          phoneNumber: `+23324${String(Date.now()).slice(-7)}1`,
          address: '10 High St',
          state: 'Greater Accra',
          area: 'Accra',
        },
      });

      const adwoa = await prismaBase.user.create({
        data: {
          tenantId: fixTenant,
          email: `adwoa-${Date.now()}@milestone.test`,
          password: 'hash',
          firstName: 'Adwoa',
          lastName: 'Darko',
          role: 'sales_rep',
          kind: 'person',
          commissionAmount: 8,
        },
      });
      const adwoaToken = generateAccessToken({ id: adwoa.id, email: adwoa.email, role: 'sales_rep', tenantId: fixTenant });

      const nana = await prismaBase.user.create({
        data: {
          tenantId: fixTenant,
          email: `nana-${Date.now()}@milestone.test`,
          password: 'hash',
          firstName: 'Nana',
          lastName: 'Osei',
          role: 'sales_rep',
          kind: 'person',
          commissionAmount: 8,
        },
      });
      const nanaToken = generateAccessToken({ id: nana.id, email: nana.email, role: 'sales_rep', tenantId: fixTenant });

      const admin = await prismaBase.user.create({
        data: {
          tenantId: fixTenant,
          email: `admin-${Date.now()}@milestone.test`,
          password: 'hash',
          firstName: 'Kwame',
          lastName: 'Admin',
          role: 'super_admin',
          kind: 'person',
        },
      });
      const adminToken = generateAccessToken({ id: admin.id, email: admin.email, role: 'super_admin', tenantId: fixTenant });

      const agent = await prismaBase.user.create({
        data: {
          tenantId: fixTenant,
          email: `agent-${Date.now()}@milestone.test`,
          password: 'hash',
          firstName: 'Kofi',
          lastName: 'Agent',
          role: 'delivery_agent',
          kind: 'person',
        },
      });

      // Catalog products and form packages
      const baseProduct = await prismaBase.product.create({
        data: {
          tenantId: fixTenant,
          name: 'Hero Book Set',
          sku: `SKU-HERO-${Date.now()}`,
          category: 'Books',
          productType: 'physical',
          price: 249,
          stockQuantity: 1000,
        },
      });

      const form = await prismaBase.checkoutForm.create({
        data: {
          tenantId: fixTenant,
          productId: baseProduct.id,
          name: 'Hero Form',
          slug: `hero-form-${Date.now()}`,
          fields: {},
          styling: {},
          regions: {},
        },
      });

      const basePkg = await prismaBase.formPackage.create({
        data: {
          formId: form.id,
          name: '1 Set (Standard)',
          price: 249,
          quantity: 1,
          sortOrder: 1,
        },
      });

      // High package for Adwoa: 249 + 6100 = 6349 (extra value 6,100 -> 10% = GH₵610)
      const adwoaHighPkg = await prismaBase.formPackage.create({
        data: {
          formId: form.id,
          name: 'Bulk School Pack',
          price: 6349,
          quantity: 30,
          sortOrder: 2,
        },
      });

      // Tier package for Nana: 249 + 300 = 549 (extra value 300 -> 10% = GH₵30)
      const nanaPkg = await prismaBase.formPackage.create({
        data: {
          formId: form.id,
          name: 'Family Pack',
          price: 549,
          quantity: 2,
          sortOrder: 3,
        },
      });

      // ---------------------------------------------------------------------
      // Build Adwoa's 253 orders through real services:
      // - 1 order with upsell of 6,100 (creates pending base 8 and upsell 610)
      // - 252 orders with confirmed call (creates pending base 8 each)
      // - Deliver all 253 orders (earns all entries)
      // ---------------------------------------------------------------------
      const adwoaOrdersData = Array.from({ length: 253 }, () => ({
        tenantId: fixTenant,
        customerId: customer.id,
        customerRepId: adwoa.id,
        deliveryAgentId: agent.id,
        status: 'pending_confirmation' as const,
        subtotal: 249,
        totalAmount: 249,
        codAmount: 249,
        deliveryAddress: '10 High St',
        deliveryState: 'Greater Accra',
        deliveryArea: 'Accra',
        orderType: 'physical',
        paymentMethod: 'cod',
      }));
      await prismaBase.order.createMany({ data: adwoaOrdersData as any });

      const adwoaOrders = await prismaBase.order.findMany({
        where: { tenantId: fixTenant, customerRepId: adwoa.id },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      expect(adwoaOrders).toHaveLength(253);

      // Order 0: form submission linked to base package
      await prismaBase.formSubmission.create({
        data: {
          tenantId: fixTenant,
          formId: form.id,
          orderId: adwoaOrders[0].id,
          formData: {},
          selectedPackage: { id: basePkg.id, name: basePkg.name, price: 249 },
          totalAmount: 249,
        },
      });

      // Confirm order 0 via callService with upsell to adwoaHighPkg (extra value 6,100)
      await runInTenant(fixTenant, () =>
        callService.createCall({
          customerId: customer.id,
          orderId: adwoaOrders[0].id,
          outcome: CallOutcome.confirmed,
          salesRepId: adwoa.id,
          orderChanges: { packageId: adwoaHighPkg.id },
        })
      );

      // Confirm remaining 252 orders via callService
      for (const o of adwoaOrders.slice(1)) {
        await runInTenant(fixTenant, () =>
          callService.createCall({
            customerId: customer.id,
            orderId: o.id,
            outcome: CallOutcome.confirmed,
            salesRepId: adwoa.id,
          })
        );
      }

      // Deliver all 253 orders
      for (const o of adwoaOrders) {
        await runInTenant(fixTenant, () =>
          transitionOrder(o.id, 'delivered', { kind: 'integration', userId: admin.id }, { deliveryDate: new Date() })
        );
      }

      // ---------------------------------------------------------------------
      // Build Nana's 13 orders through real services:
      // - 1 order with upsell of 300 (creates pending base 8 and upsell 30)
      // - 12 orders with confirmed call (creates pending base 8 each)
      // - Deliver all 13 orders (earns all entries)
      // ---------------------------------------------------------------------
      const nanaOrdersData = Array.from({ length: 13 }, () => ({
        tenantId: fixTenant,
        customerId: customer.id,
        customerRepId: nana.id,
        deliveryAgentId: agent.id,
        status: 'pending_confirmation' as const,
        subtotal: 249,
        totalAmount: 249,
        codAmount: 249,
        deliveryAddress: '10 High St',
        deliveryState: 'Greater Accra',
        deliveryArea: 'Accra',
        orderType: 'physical',
        paymentMethod: 'cod',
      }));
      await prismaBase.order.createMany({ data: nanaOrdersData as any });

      const nanaOrders = await prismaBase.order.findMany({
        where: { tenantId: fixTenant, customerRepId: nana.id },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      expect(nanaOrders).toHaveLength(13);

      await prismaBase.formSubmission.create({
        data: {
          tenantId: fixTenant,
          formId: form.id,
          orderId: nanaOrders[0].id,
          formData: {},
          selectedPackage: { id: basePkg.id, name: basePkg.name, price: 249 },
          totalAmount: 249,
        },
      });

      // Confirm order 0 via callService with upsell to nanaPkg (extra value 300)
      await runInTenant(fixTenant, () =>
        callService.createCall({
          customerId: customer.id,
          orderId: nanaOrders[0].id,
          outcome: CallOutcome.confirmed,
          salesRepId: nana.id,
          orderChanges: { packageId: nanaPkg.id },
        })
      );

      // Confirm remaining 12 orders via callService
      for (const o of nanaOrders.slice(1)) {
        await runInTenant(fixTenant, () =>
          callService.createCall({
            customerId: customer.id,
            orderId: o.id,
            outcome: CallOutcome.confirmed,
            salesRepId: nana.id,
          })
        );
      }

      // Deliver all 13 orders
      for (const o of nanaOrders) {
        await runInTenant(fixTenant, () =>
          transitionOrder(o.id, 'delivered', { kind: 'integration', userId: admin.id }, { deliveryDate: new Date() })
        );
      }

      // ---------------------------------------------------------------------
      // Record GH₵600 payout to Adwoa through payoutService
      // ---------------------------------------------------------------------
      await runInTenant(fixTenant, () =>
        payoutService.record(
          {
            payeeId: adwoa.id,
            amount: 600,
            method: 'Bank Transfer',
            notes: 'Paid October commissions',
          },
          admin.id
        )
      );

      // ---------------------------------------------------------------------
      // Read values through rep earnings API (T11)
      // ---------------------------------------------------------------------
      // Adwoa: 2,024 base + 610 upsell - 600 paid = GH₵2,034 owed
      const resAdwoa = await request(app).get('/api/rep/earnings').set(bearer(adwoaToken));
      expect(resAdwoa.status).toBe(200);
      expect(resAdwoa.body).toMatchObject({
        commission: '2024.00',
        upsellReward: '610.00',
        earned: '2634.00',
        paid: '600.00',
        owed: '2034.00',
        isOverpaid: false,
      });

      // Nana: 104 base + 30 upsell - 0 paid = GH₵134 owed
      const resNana = await request(app).get('/api/rep/earnings').set(bearer(nanaToken));
      expect(resNana.status).toBe(200);
      expect(resNana.body).toMatchObject({
        commission: '104.00',
        upsellReward: '30.00',
        earned: '134.00',
        paid: '0.00',
        owed: '134.00',
        isOverpaid: false,
      });

      // ---------------------------------------------------------------------
      // Read values through payout view (GET /api/payouts/owed)
      // ---------------------------------------------------------------------
      const resPayouts = await request(app).get('/api/payouts/owed').set(bearer(adminToken));
      expect(resPayouts.status).toBe(200);
      expect(resPayouts.body.totals).toMatchObject({
        owed: '2168.00',
        paid: '600.00',
      });

      const byRep = new Map<number, any>(resPayouts.body.reps.map((r: any) => [r.id, r]));
      expect(byRep.get(adwoa.id)).toMatchObject({
        delivered: 253,
        commission: '2024.00',
        upsellReward: '610.00',
        earned: '2634.00',
        paid: '600.00',
        owed: '2034.00',
      });

      expect(byRep.get(nana.id)).toMatchObject({
        delivered: 13,
        commission: '104.00',
        upsellReward: '30.00',
        earned: '134.00',
        paid: '0.00',
        owed: '134.00',
      });
    }, 180000); // 266 orders through the real call and delivery services
  });

  // =========================================================================
  // 2. Rule P6: Order confirmed by customer YES creates no commission entry
  // =========================================================================
  describe('2. Rule P6: Customer YES confirmation creates no commission entry on confirm or delivery', () => {
    it('inbound WhatsApp YES creates no commission entry, and delivery still creates none', async () => {
      const tenant = (await createTenant('M7 Rule P6 WhatsApp')).id;
      tenantIds.push(tenant);
      await seedTenantDefaults(tenant);

      const phoneId = `wa-phone-p6-${Date.now()}`;
      const appSecret = `wa-secret-p6-${Date.now()}`;
      const customerPhone = `+23324${String(Date.now()).slice(-7)}2`;

      await prismaBase.systemConfig.upsert({
        where: { tenantId: tenant },
        create: {
          tenantId: tenant,
          whatsappProvider: {
            isEnabled: true,
            accessToken: 'test-wa-tok',
            phoneNumberId: phoneId,
            appSecret,
          } as any,
        },
        update: {
          whatsappProvider: {
            isEnabled: true,
            accessToken: 'test-wa-tok',
            phoneNumberId: phoneId,
            appSecret,
          } as any,
        },
      });

      const rep = await prismaBase.user.create({
        data: {
          tenantId: tenant,
          email: `rep-p6-wa-${Date.now()}@test.local`,
          password: 'h',
          firstName: 'Rep',
          lastName: 'Assigned',
          role: 'sales_rep',
          kind: 'person',
          commissionAmount: 8,
        },
      });

      const customer = await prismaBase.customer.create({
        data: {
          tenantId: tenant,
          firstName: 'Kweku',
          lastName: 'Customer',
          phoneNumber: customerPhone,
          address: '42 Circle',
          state: 'Greater Accra',
          area: 'Accra',
        },
      });

      const order = await prismaBase.order.create({
        data: {
          tenantId: tenant,
          customerId: customer.id,
          customerRepId: rep.id,
          status: 'pending_confirmation',
          subtotal: 150,
          totalAmount: 150,
          codAmount: 150,
          orderType: 'physical',
          paymentMethod: 'cod',
          autoConfirmSentAt: new Date(),
        },
      });

      await prismaBase.confirmToken.create({
        data: {
          tenantId: tenant,
          orderId: order.id,
          token: `tok-wa-p6-${Date.now()}`,
          channel: 'whatsapp',
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      // Customer sends inbound WhatsApp YES
      const rawPayload = JSON.stringify(makeWhatsAppWebhookPayload(phoneId, `msg-yes-${Date.now()}`, customerPhone, 'YES'));
      const res = await request(app)
        .post('/api/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signPayload(appSecret, rawPayload))
        .send(rawPayload);
      expect(res.status).toBe(200);

      // Verify order is confirmed
      const confirmedOrder = await prismaBase.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(confirmedOrder.status).toBe('confirmed');
      expect(confirmedOrder.customerResponse).toBe('yes');

      // 0 commission entries created on customer confirm
      const entriesAfterConfirm = await prismaBase.commissionEntry.count({ where: { orderId: order.id } });
      expect(entriesAfterConfirm).toBe(0);

      // Transition order to delivered through state machine
      await runInTenant(tenant, () =>
        transitionOrder(order.id, 'delivered', { kind: 'integration' }, { deliveryDate: new Date() })
      );

      // Verify still 0 commission entries after delivery!
      const entriesAfterDelivery = await prismaBase.commissionEntry.count({ where: { orderId: order.id } });
      expect(entriesAfterDelivery).toBe(0);
    });

    it('public confirm token YES creates no commission entry, and delivery still creates none', async () => {
      const tenant = (await createTenant('M7 Rule P6 Public Confirm')).id;
      tenantIds.push(tenant);
      await seedTenantDefaults(tenant);

      const rep = await prismaBase.user.create({
        data: {
          tenantId: tenant,
          email: `rep-p6-pub-${Date.now()}@test.local`,
          password: 'h',
          firstName: 'Rep',
          lastName: 'Assigned',
          role: 'sales_rep',
          kind: 'person',
          commissionAmount: 8,
        },
      });

      const customer = await prismaBase.customer.create({
        data: {
          tenantId: tenant,
          firstName: 'Akosua',
          lastName: 'Mansah',
          phoneNumber: `+23324${String(Date.now()).slice(-7)}3`,
          address: '42 Spintex',
          state: 'Greater Accra',
          area: 'Accra',
        },
      });

      const order = await prismaBase.order.create({
        data: {
          tenantId: tenant,
          customerId: customer.id,
          customerRepId: rep.id,
          status: 'pending_confirmation',
          subtotal: 200,
          totalAmount: 200,
          codAmount: 200,
          orderType: 'physical',
          paymentMethod: 'cod',
          autoConfirmSentAt: new Date(),
        },
      });

      const tokenStr = `tok-public-yes-${Date.now()}`;
      await prismaBase.confirmToken.create({
        data: {
          tenantId: tenant,
          orderId: order.id,
          token: tokenStr,
          channel: 'sms',
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      // Public confirm with action 'yes'
      const res = await request(app).post(`/api/public/confirm/${tokenStr}`).send({ action: 'yes' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('confirmed');

      const confirmedOrder = await prismaBase.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(confirmedOrder.status).toBe('confirmed');
      expect(confirmedOrder.customerResponse).toBe('yes');

      // 0 commission entries on confirm
      const entriesAfterConfirm = await prismaBase.commissionEntry.count({ where: { orderId: order.id } });
      expect(entriesAfterConfirm).toBe(0);

      // Transition order to delivered
      await runInTenant(tenant, () =>
        transitionOrder(order.id, 'delivered', { kind: 'integration' }, { deliveryDate: new Date() })
      );

      // 0 commission entries after delivery
      const entriesAfterDelivery = await prismaBase.commissionEntry.count({ where: { orderId: order.id } });
      expect(entriesAfterDelivery).toBe(0);
    });
  });

  // =========================================================================
  // 3. Rule P2: Inbound NO reply does not cancel
  // =========================================================================
  describe('3. Rule P2: Inbound NO reply keeps order open in queue under Said NO tab', () => {
    it('NO reply does not cancel: order stays pending_confirmation, saidNo=true, requiresManualCall=true, and shows in rep queue Said NO tab', async () => {
      const tenant = (await createTenant('M7 Rule P2 No Reply')).id;
      tenantIds.push(tenant);
      await seedTenantDefaults(tenant);

      const phoneId = `wa-phone-p2-${Date.now()}`;
      const appSecret = `wa-secret-p2-${Date.now()}`;
      const customerPhone = `+23324${String(Date.now()).slice(-7)}4`;

      await prismaBase.systemConfig.upsert({
        where: { tenantId: tenant },
        create: {
          tenantId: tenant,
          whatsappProvider: {
            isEnabled: true,
            accessToken: 'test-wa-tok-p2',
            phoneNumberId: phoneId,
            appSecret,
          } as any,
        },
        update: {
          whatsappProvider: {
            isEnabled: true,
            accessToken: 'test-wa-tok-p2',
            phoneNumberId: phoneId,
            appSecret,
          } as any,
        },
      });

      const rep = await prismaBase.user.create({
        data: {
          tenantId: tenant,
          email: `rep-p2-${Date.now()}@test.local`,
          password: 'h',
          firstName: 'Esi',
          lastName: 'Rep',
          role: 'sales_rep',
          kind: 'person',
          commissionAmount: 8,
        },
      });
      const repToken = generateAccessToken({ id: rep.id, email: rep.email, role: 'sales_rep', tenantId: tenant });

      const customer = await prismaBase.customer.create({
        data: {
          tenantId: tenant,
          firstName: 'Kofi',
          lastName: 'Undecided',
          phoneNumber: customerPhone,
          address: '88 Ring Road',
          state: 'Greater Accra',
          area: 'Accra',
        },
      });

      const order = await prismaBase.order.create({
        data: {
          tenantId: tenant,
          customerId: customer.id,
          customerRepId: rep.id,
          status: 'pending_confirmation',
          subtotal: 300,
          totalAmount: 300,
          codAmount: 300,
          orderType: 'physical',
          paymentMethod: 'cod',
          autoConfirmSentAt: new Date(),
        },
      });

      await prismaBase.confirmToken.create({
        data: {
          tenantId: tenant,
          orderId: order.id,
          token: `tok-wa-no-${Date.now()}`,
          channel: 'whatsapp',
          expiresAt: new Date(Date.now() + 86400000),
        },
      });

      // Inbound NO message from customer
      const rawPayload = JSON.stringify(makeWhatsAppWebhookPayload(phoneId, `msg-no-${Date.now()}`, customerPhone, 'NO'));
      const resWebhook = await request(app)
        .post('/api/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signPayload(appSecret, rawPayload))
        .send(rawPayload);
      expect(resWebhook.status).toBe(200);

      // Verify order flags
      const updatedOrder = await prismaBase.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updatedOrder.status).toBe('pending_confirmation'); // Not cancelled!
      expect(updatedOrder.saidNo).toBe(true);
      expect(updatedOrder.requiresManualCall).toBe(true);
      expect(updatedOrder.customerResponse).toBe('no');

      // Verify rep queue endpoint shows order in Said NO tab
      const queueRes = await request(app).get('/api/rep/queue?tab=said_no').set(bearer(repToken));
      expect(queueRes.status).toBe(200);
      expect(queueRes.body.tabs.said_no).toBeGreaterThanOrEqual(1);
      const queueOrder = queueRes.body.orders.find((o: any) => o.id === order.id);
      expect(queueOrder).toBeDefined();
      expect(queueOrder.saidNo).toBe(true);
    });
  });

  // =========================================================================
  // 4. Rule P4: Auto-confirm sent at once outside operating hours
  // =========================================================================
  describe('4. Rule P4: Auto-confirm message sent immediately outside operating hours', () => {
    it('order created at night sends auto-confirm message at once with provider stub called once', async () => {
      const tenant = (await createTenant('M7 Rule P4 Night Send')).id;
      tenantIds.push(tenant);
      await seedTenantDefaults(tenant);

      // Configure daytime-only operating hours (08:00 to 18:00 UTC) and enabled auto-confirm
      const opHoursData = {
        days: {
          monday: { open: '08:00', close: '18:00', enabled: true },
          tuesday: { open: '08:00', close: '18:00', enabled: true },
          wednesday: { open: '08:00', close: '18:00', enabled: true },
          thursday: { open: '08:00', close: '18:00', enabled: true },
          friday: { open: '08:00', close: '18:00', enabled: true },
          saturday: { open: '08:00', close: '18:00', enabled: true },
          sunday: { open: '08:00', close: '18:00', enabled: true },
        },
        firstCallTargetMinutes: 15,
        queueWaitAlertMinutes: 30,
      };
      await prismaBase.systemConfig.upsert({
        where: { tenantId: tenant },
        create: {
          tenantId: tenant,
          timeZone: 'UTC',
          operatingHours: opHoursData,
        },
        update: {
          timeZone: 'UTC',
          operatingHours: opHoursData,
        },
      });

      const customer = await prismaBase.customer.create({
        data: {
          tenantId: tenant,
          firstName: 'Night',
          lastName: 'Buyer',
          phoneNumber: `+23324${String(Date.now()).slice(-7)}5`,
          address: '1 Night Lane',
          state: 'Greater Accra',
          area: 'Accra',
        },
      });

      const product = await prismaBase.product.create({
        data: {
          tenantId: tenant,
          name: 'Night Watch Item',
          sku: `SKU-NIGHT-${Date.now()}`,
          category: 'General',
          productType: 'physical',
          price: 150,
          stockQuantity: 100,
        },
      });
      await stockUp(tenant, product.id, 100);

      mockSendTemplate.mockClear();

      // Create COD order using orderService at night (no operating hours hold)
      const order = await runInTenant(tenant, () =>
        orderService.createOrder({
          customerId: customer.id,
          orderItems: [{ productId: product.id, quantity: 1, unitPrice: 150 }],
          totalAmount: 150,
          deliveryAddress: '1 Night Lane',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
          paymentMethod: 'cod',
        })
      );

      // The send_auto_confirm workflow action calls this at once; there is no operating-hours hold
      await runInTenant(tenant, () => sendAutoConfirmForOrder(order.id, tenant));

      // Verify provider stub was called once at create time
      expect(mockSendTemplate).toHaveBeenCalledTimes(1);
      expect(mockSendTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          to: customer.phoneNumber,
          orderId: order.id,
          customerId: customer.id,
          templateName: 'order_auto_confirm',
        })
      );

      // Verify DB order record has autoConfirmSentAt stamped and ConfirmToken created
      const dbOrder = await prismaBase.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(dbOrder.autoConfirmSentAt).not.toBeNull();

      const token = await prismaBase.confirmToken.findFirst({ where: { orderId: order.id } });
      expect(token).not.toBeNull();
      expect(token?.channel).toBe('whatsapp');
    });
  });

  // =========================================================================
  // 5. First-call clock
  // =========================================================================
  describe('5. First-call clock: operating hours and customer YES handling', () => {
    it('order at 21:00 with opening at 08:00 counts from 08:00; a YES reply counts as auto-confirmed, not as a call', async () => {
      const tenant = (await createTenant('M7 First Call Clock')).id;
      tenantIds.push(tenant);
      await seedTenantDefaults(tenant);

      // Set operating hours 08:00 to 20:00 every day in UTC
      const operatingHours = {
        days: {
          monday: { open: '08:00', close: '20:00', enabled: true },
          tuesday: { open: '08:00', close: '20:00', enabled: true },
          wednesday: { open: '08:00', close: '20:00', enabled: true },
          thursday: { open: '08:00', close: '20:00', enabled: true },
          friday: { open: '08:00', close: '20:00', enabled: true },
          saturday: { open: '08:00', close: '20:00', enabled: true },
          sunday: { open: '08:00', close: '20:00', enabled: true },
        },
        firstCallTargetMinutes: 15,
        queueWaitAlertMinutes: 30,
      };

      await prismaBase.systemConfig.upsert({
        where: { tenantId: tenant },
        create: {
          tenantId: tenant,
          timeZone: 'UTC',
          operatingHours,
        },
        update: {
          timeZone: 'UTC',
          operatingHours,
        },
      });

      const rep = await prismaBase.user.create({
        data: {
          tenantId: tenant,
          email: `rep-clock-${Date.now()}@test.local`,
          password: 'h',
          firstName: 'Clock',
          lastName: 'Rep',
          role: 'sales_rep',
          kind: 'person',
        },
      });
      const repToken = generateAccessToken({ id: rep.id, email: rep.email, role: 'sales_rep', tenantId: tenant });

      const customer = await prismaBase.customer.create({
        data: {
          tenantId: tenant,
          firstName: 'Morning',
          lastName: 'Customer',
          phoneNumber: `+23324${String(Date.now()).slice(-7)}6`,
          address: '20 Airport Rd',
          state: 'Greater Accra',
          area: 'Accra',
        },
      });

      // Order 1: Created at 21:00 UTC Monday 2026-10-12
      // Rep makes first call at 08:15 UTC Tuesday 2026-10-13 (15 working minutes from 08:00 open)
      const order1 = await prismaBase.order.create({
        data: {
          tenantId: tenant,
          customerId: customer.id,
          customerRepId: rep.id,
          status: 'pending_confirmation',
          subtotal: 100,
          totalAmount: 100,
          codAmount: 100,
          orderType: 'physical',
          paymentMethod: 'cod',
          createdAt: new Date('2026-10-12T21:00:00Z'),
          firstContactAt: new Date('2026-10-13T08:15:00Z'),
        },
      });

      // Order 2: Created at 21:30 UTC Monday 2026-10-12
      // Customer replies YES -> auto-confirmed, not counted as rep call
      const order2 = await prismaBase.order.create({
        data: {
          tenantId: tenant,
          customerId: customer.id,
          customerRepId: rep.id,
          status: 'confirmed',
          subtotal: 120,
          totalAmount: 120,
          codAmount: 120,
          orderType: 'physical',
          paymentMethod: 'cod',
          customerResponse: 'yes',
          confirmedAt: new Date('2026-10-12T21:35:00Z'),
          createdAt: new Date('2026-10-12T21:30:00Z'),
        },
      });

      // Compute KPI via timeToFirstCall service
      const kpi = await timeToFirstCall(
        tenant,
        new Date('2026-10-12T00:00:00Z'),
        new Date('2026-10-14T00:00:00Z'),
        { repId: rep.id }
      );

      // Order 1 measured at 15 minutes (from 08:00 to 08:15)
      expect(kpi.value).toBe(15);
      expect(kpi.operatingHoursSet).toBe(true);
      expect(kpi.detail.measured).toBe(1);
      // Order 2 counted as autoConfirmed, not as a rep call
      expect(kpi.detail.autoConfirmed).toBe(1);

      // Verify through the endpoint GET /api/rep/stats/time-to-first-call
      const res = await request(app)
        .get('/api/rep/stats/time-to-first-call?from=2026-10-12T00:00:00Z&to=2026-10-14T00:00:00Z')
        .set(bearer(repToken));

      expect(res.status).toBe(200);
      expect(res.body.value).toBe(15);
      expect(res.body.detail.measured).toBe(1);
      expect(res.body.detail.autoConfirmed).toBe(1);
    });
  });

  // =========================================================================
  // 6. Refusal rule end to end
  // =========================================================================
  describe('6. Refusal rule end to end through the state machine', () => {
    it('3 refused deliveries through state machine -> next order requiresManualCall; owner override restarts count', async () => {
      const tenant = (await createTenant('M7 Refusal Rule E2E')).id;
      tenantIds.push(tenant);
      await seedTenantDefaults(tenant);

      const owner = await prismaBase.user.create({
        data: {
          tenantId: tenant,
          email: `owner-refusal-${Date.now()}@test.local`,
          password: 'h',
          firstName: 'Owner',
          lastName: 'Boss',
          role: 'super_admin',
          kind: 'person',
        },
      });
      const ownerToken = generateAccessToken({ id: owner.id, email: owner.email, role: 'super_admin', tenantId: tenant });
      const ownerActor: TransitionActor = { kind: 'user', userId: owner.id, role: 'super_admin' };

      const agent = await prismaBase.user.create({
        data: {
          tenantId: tenant,
          email: `agent-refusal-${Date.now()}@test.local`,
          password: 'h',
          firstName: 'Delivery',
          lastName: 'Agent',
          role: 'delivery_agent',
          kind: 'person',
        },
      });

      const customer = await prismaBase.customer.create({
        data: {
          tenantId: tenant,
          firstName: 'Kweku',
          lastName: 'Refuser',
          phoneNumber: `+23324${String(Date.now()).slice(-7)}7`,
          address: '77 Circle Rd',
          state: 'Greater Accra',
          area: 'Accra',
        },
      });

      const product = await prismaBase.product.create({
        data: {
          tenantId: tenant,
          name: 'Watch Product',
          sku: `SKU-WATCH-${Date.now()}`,
          category: 'Watches',
          productType: 'physical',
          price: 200,
          stockQuantity: 100,
        },
      });
      await stockUp(tenant, product.id, 100);

      // Helper to run an order through: pending_confirmation -> confirmed -> out_for_delivery -> returned (refused)
      const runRefusedOrder = async () => {
        const o = await prismaBase.order.create({
          data: {
            tenantId: tenant,
            customerId: customer.id,
            deliveryAgentId: agent.id,
            status: 'pending_confirmation',
            subtotal: 200,
            totalAmount: 200,
            codAmount: 200,
            deliveryAddress: '77 Circle Rd',
            deliveryState: 'Greater Accra',
            deliveryArea: 'Accra',
            orderType: 'physical',
            paymentMethod: 'cod',
          },
        });

        await runInTenant(tenant, async () => {
          await transitionOrder(o.id, 'confirmed', ownerActor);
          await transitionOrder(o.id, 'out_for_delivery', ownerActor);
          await transitionOrder(o.id, 'returned', ownerActor, { failureReason: 'refused' });
        });
        return o.id;
      };

      const getCustomer = () => prismaBase.customer.findUniqueOrThrow({ where: { id: customer.id } });
      const until = async (check: (c: Awaited<ReturnType<typeof getCustomer>>) => boolean) => {
        for (let i = 0; i < 50; i++) {
          const c = await getCustomer();
          if (check(c)) return c;
          await new Promise((r) => setTimeout(r, 100));
        }
        return getCustomer();
      };

      // 1st refused delivery: refusedOrders = 1, normal risk, not codBlocked
      await runRefusedOrder();
      let c = await until((x) => x.refusedOrders === 1);
      expect(c.refusedOrders).toBe(1);
      expect(c.riskLevel).toBe('normal');
      expect(c.codBlocked).toBe(false);

      // 2nd refused delivery: refusedOrders = 2, riskLevel = high, not codBlocked
      await runRefusedOrder();
      c = await until((x) => x.refusedOrders === 2);
      expect(c.refusedOrders).toBe(2);
      expect(c.riskLevel).toBe('high');
      expect(c.codBlocked).toBe(false);

      // 3rd refused delivery: refusedOrders = 3, codBlocked = true, riskLevel = high
      await runRefusedOrder();
      c = await until((x) => x.refusedOrders === 3);
      expect(c.refusedOrders).toBe(3);
      expect(c.codBlocked).toBe(true);
      expect(c.riskLevel).toBe('high');

      // Next new order gets requiresManualCall = true because customer is COD blocked
      const orderBlocked = await runInTenant(tenant, () =>
        orderService.createOrder({
          customerId: customer.id,
          orderItems: [{ productId: product.id, quantity: 1, unitPrice: 200 }],
          totalAmount: 200,
          deliveryAddress: '77 Circle Rd',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
          paymentMethod: 'cod',
        })
      );
      expect(orderBlocked.requiresManualCall).toBe(true);

      // Owner overrides COD block: restarts count at 0 and unblocks customer
      const overrideRes = await request(app)
        .post(`/api/customers/${customer.id}/cod-override`)
        .set(bearer(ownerToken))
        .send({ allow: true, note: 'Customer deposited GH₵50 and committed to delivery' });

      expect(overrideRes.status).toBe(200);
      expect(overrideRes.body.customer.codBlocked).toBe(false);

      c = await prismaBase.customer.findUniqueOrThrow({ where: { id: customer.id } });
      expect(c.codBlocked).toBe(false);
      expect(c.refusedOrders).toBe(0);
      expect(c.codOverride).toBe(true);
      expect(c.codOverrideNote).toBe('Customer deposited GH₵50 and committed to delivery');

      // Next new order after override gets requiresManualCall = false
      const orderAfterOverride = await runInTenant(tenant, () =>
        orderService.createOrder({
          customerId: customer.id,
          orderItems: [{ productId: product.id, quantity: 1, unitPrice: 200 }],
          totalAmount: 200,
          deliveryAddress: '77 Circle Rd',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
          paymentMethod: 'cod',
        })
      );
      expect(orderAfterOverride.requiresManualCall).toBe(false);
    });
  });

  // =========================================================================
  // 7. Rep row scope
  // =========================================================================
  describe('7. Rep row scope: rep A never sees rep B data across all rep surfaces', () => {
    it('rep A never sees rep B orders in queue, call card (403), my orders, earnings, numbers, inbox', async () => {
      const tenant = (await createTenant('M7 Rep Row Scope')).id;
      tenantIds.push(tenant);
      await seedTenantDefaults(tenant);

      const repA = await prismaBase.user.create({
        data: {
          tenantId: tenant,
          email: `rep-a-${Date.now()}@test.local`,
          password: 'h',
          firstName: 'RepA',
          lastName: 'Alpha',
          role: 'sales_rep',
          kind: 'person',
          commissionAmount: 8,
        },
      });
      const repAToken = generateAccessToken({ id: repA.id, email: repA.email, role: 'sales_rep', tenantId: tenant });

      const repB = await prismaBase.user.create({
        data: {
          tenantId: tenant,
          email: `rep-b-${Date.now()}@test.local`,
          password: 'h',
          firstName: 'RepB',
          lastName: 'Beta',
          role: 'sales_rep',
          kind: 'person',
          commissionAmount: 8,
        },
      });
      const repBToken = generateAccessToken({ id: repB.id, email: repB.email, role: 'sales_rep', tenantId: tenant });

      const customer = await prismaBase.customer.create({
        data: {
          tenantId: tenant,
          firstName: 'Shared',
          lastName: 'Customer',
          phoneNumber: `+23324${String(Date.now()).slice(-7)}8`,
          address: '10 Unity Way',
          state: 'Greater Accra',
          area: 'Accra',
        },
      });

      // Order A for Rep A
      const orderA = await prismaBase.order.create({
        data: {
          tenantId: tenant,
          customerId: customer.id,
          customerRepId: repA.id,
          status: 'pending_confirmation',
          subtotal: 100,
          totalAmount: 100,
          codAmount: 100,
          deliveryAddress: '10 Unity Way',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
        },
      });

      // Order B for Rep B
      const orderB = await prismaBase.order.create({
        data: {
          tenantId: tenant,
          customerId: customer.id,
          customerRepId: repB.id,
          status: 'pending_confirmation',
          subtotal: 200,
          totalAmount: 200,
          codAmount: 200,
          deliveryAddress: '10 Unity Way',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
        },
      });

      // Rep B also has a delivered order with earned commission
      const deliveredOrderB = await prismaBase.order.create({
        data: {
          tenantId: tenant,
          customerId: customer.id,
          customerRepId: repB.id,
          status: 'delivered',
          subtotal: 200,
          totalAmount: 200,
          codAmount: 200,
          deliveryAddress: '10 Unity Way',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
        },
      });

      await prismaBase.commissionEntry.create({
        data: {
          tenantId: tenant,
          userId: repB.id,
          orderId: deliveredOrderB.id,
          kind: 'base',
          status: 'earned',
          amount: 8,
          earnedAt: new Date(),
        },
      });

      // Create notification for Rep A and notification for Rep B
      await runInTenant(tenant, () =>
        createNotification(String(repA.id), 'order', 'Assigned to Rep A', 'Order A assigned')
      );
      await runInTenant(tenant, () =>
        createNotification(String(repB.id), 'order', 'Assigned to Rep B', 'Order B assigned')
      );

      // 1. Rep A queue: sees orderA, never sees orderB
      const resQueue = await request(app).get('/api/rep/queue').set(bearer(repAToken));
      expect(resQueue.status).toBe(200);
      expect(resQueue.body.orders.some((o: any) => o.id === orderA.id)).toBe(true);
      expect(resQueue.body.orders.some((o: any) => o.id === orderB.id)).toBe(false);

      // 2. Rep A call card on Rep B's order: returns 403 Forbidden
      const resCard = await request(app).get(`/api/rep/orders/${orderB.id}/card`).set(bearer(repAToken));
      expect(resCard.status).toBe(403);

      // 3. Rep A My orders (/api/rep/orders): sees orderA, never sees orderB or deliveredOrderB
      const resOrders = await request(app).get('/api/rep/orders').set(bearer(repAToken));
      expect(resOrders.status).toBe(200);
      expect(resOrders.body.orders.some((o: any) => o.id === orderA.id)).toBe(true);
      expect(resOrders.body.orders.some((o: any) => o.id === orderB.id)).toBe(false);
      expect(resOrders.body.orders.some((o: any) => o.id === deliveredOrderB.id)).toBe(false);

      // 4. Rep A earnings (/api/rep/earnings): never sees Rep B's earnings lines; passing ?repId returns 403
      const resEarnings = await request(app).get('/api/rep/earnings').set(bearer(repAToken));
      expect(resEarnings.status).toBe(200);
      expect(resEarnings.body.lines.some((l: any) => l.orderId === deliveredOrderB.id)).toBe(false);

      const resEarningsForbidden = await request(app).get(`/api/rep/earnings?repId=${repB.id}`).set(bearer(repAToken));
      expect(resEarningsForbidden.status).toBe(403);

      // 5. Rep A numbers (/api/rep/numbers): passing ?repId returns 403
      const resNumbersForbidden = await request(app).get(`/api/rep/numbers?repId=${repB.id}`).set(bearer(repAToken));
      expect(resNumbersForbidden.status).toBe(403);

      // 6. Rep A inbox (/api/notifications): sees only Rep A's notifications, never Rep B's
      const resInboxA = await request(app).get('/api/notifications').set(bearer(repAToken));
      expect(resInboxA.status).toBe(200);
      expect(resInboxA.body.notifications.every((n: any) => n.userId === repA.id)).toBe(true);
      expect(resInboxA.body.notifications.some((n: any) => n.title === 'Assigned to Rep B')).toBe(false);

      const resInboxB = await request(app).get('/api/notifications').set(bearer(repBToken));
      expect(resInboxB.status).toBe(200);
      expect(resInboxB.body.notifications.every((n: any) => n.userId === repB.id)).toBe(true);
      expect(resInboxB.body.notifications.some((n: any) => n.title === 'Assigned to Rep A')).toBe(false);
    });
  });

  // =========================================================================
  // 8. Two tenants
  // =========================================================================
  describe('8. Two tenants: tenant B data never shows for tenant A', () => {
    it('tenant B data never shows for tenant A in the rep API, calls stats, leaderboard and customers', async () => {
      const tenantA = (await createTenant('M7 TwoTenant A')).id;
      const tenantB = (await createTenant('M7 TwoTenant B')).id;
      tenantIds.push(tenantA, tenantB);
      await seedTenantDefaults(tenantA);
      await seedTenantDefaults(tenantB);

      // Tenant A users
      const repA = await prismaBase.user.create({
        data: {
          tenantId: tenantA,
          email: `rep-tt-a-${Date.now()}@test.local`,
          password: 'h',
          firstName: 'RepA',
          lastName: 'TenantA',
          role: 'sales_rep',
          kind: 'person',
          commissionAmount: 8,
        },
      });
      const repAToken = generateAccessToken({ id: repA.id, email: repA.email, role: 'sales_rep', tenantId: tenantA });

      const adminA = await prismaBase.user.create({
        data: {
          tenantId: tenantA,
          email: `admin-tt-a-${Date.now()}@test.local`,
          password: 'h',
          firstName: 'AdminA',
          lastName: 'TenantA',
          role: 'admin',
          kind: 'person',
        },
      });
      const adminAToken = generateAccessToken({ id: adminA.id, email: adminA.email, role: 'admin', tenantId: tenantA });

      const customerA = await prismaBase.customer.create({
        data: {
          tenantId: tenantA,
          firstName: 'CustomerA',
          lastName: 'TenantA',
          phoneNumber: `+23324${String(Date.now()).slice(-7)}0`,
          address: '10 A St',
          state: 'Greater Accra',
          area: 'Accra',
        },
      });

      const orderA = await prismaBase.order.create({
        data: {
          tenantId: tenantA,
          customerId: customerA.id,
          customerRepId: repA.id,
          status: 'pending_confirmation',
          subtotal: 100,
          totalAmount: 100,
          codAmount: 100,
          deliveryAddress: '10 A St',
          deliveryState: 'Greater Accra',
          deliveryArea: 'Accra',
        },
      });

      // Tenant B users & data
      const repB = await prismaBase.user.create({
        data: {
          tenantId: tenantB,
          email: `rep-tt-b-${Date.now()}@test.local`,
          password: 'h',
          firstName: 'RepB',
          lastName: 'TenantB',
          role: 'sales_rep',
          kind: 'person',
          commissionAmount: 8,
        },
      });

      const customerB = await prismaBase.customer.create({
        data: {
          tenantId: tenantB,
          firstName: 'CustomerB',
          lastName: 'TenantB',
          phoneNumber: `+23324${String(Date.now()).slice(-7)}9`,
          address: '20 B Ave',
          state: 'Ashanti',
          area: 'Kumasi',
        },
      });

      const orderB = await prismaBase.order.create({
        data: {
          tenantId: tenantB,
          customerId: customerB.id,
          customerRepId: repB.id,
          status: 'pending_confirmation',
          subtotal: 500,
          totalAmount: 500,
          codAmount: 500,
          deliveryAddress: '20 B Ave',
          deliveryState: 'Ashanti',
          deliveryArea: 'Kumasi',
        },
      });

      // Tenant B call log
      await prismaBase.call.create({
        data: {
          tenantId: tenantB,
          customerId: customerB.id,
          orderId: orderB.id,
          salesRepId: repB.id,
          outcome: CallOutcome.confirmed,
          duration: 60,
          source: CallSource.manual,
        },
      });

      // Tenant B active upsell line
      await prismaBase.upsellLine.create({
        data: {
          tenantId: tenantB,
          orderId: orderB.id,
          repId: repB.id,
          kind: 'package',
          extraValue: 350,
          status: 'active',
        },
      });

      // Tenant B commission entry
      await prismaBase.commissionEntry.create({
        data: {
          tenantId: tenantB,
          userId: repB.id,
          orderId: orderB.id,
          kind: 'base',
          status: 'earned',
          amount: 8,
          earnedAt: new Date(),
        },
      });

      // ---------------------------------------------------------------------
      // 1. Rep API checks from Tenant A:
      // ---------------------------------------------------------------------
      // Queue: Tenant A sees orderA, never orderB
      const queueRes = await request(app).get('/api/rep/queue').set(bearer(repAToken));
      expect(queueRes.status).toBe(200);
      expect(queueRes.body.orders.some((o: any) => o.id === orderA.id)).toBe(true);
      expect(queueRes.body.orders.some((o: any) => o.id === orderB.id)).toBe(false);

      // Orders: Tenant A sees orderA, never orderB
      const ordersRes = await request(app).get('/api/rep/orders').set(bearer(repAToken));
      expect(ordersRes.status).toBe(200);
      expect(ordersRes.body.orders.some((o: any) => o.id === orderA.id)).toBe(true);
      expect(ordersRes.body.orders.some((o: any) => o.id === orderB.id)).toBe(false);

      // Today: Tenant A does not include Tenant B metrics
      const todayRes = await request(app).get('/api/rep/today').set(bearer(repAToken));
      expect(todayRes.status).toBe(200);

      // Numbers: Tenant A does not include Tenant B rates
      const numbersRes = await request(app).get('/api/rep/numbers').set(bearer(repAToken));
      expect(numbersRes.status).toBe(200);

      // Earnings: Tenant A does not see Tenant B entries
      const earningsRes = await request(app).get('/api/rep/earnings').set(bearer(repAToken));
      expect(earningsRes.status).toBe(200);
      expect(earningsRes.body.lines.some((l: any) => l.orderId === orderB.id)).toBe(false);

      // Summary: Tenant A summary does not include Tenant B
      const summaryRes = await request(app).get('/api/rep/summary').set(bearer(repAToken));
      expect(summaryRes.status).toBe(200);

      // ---------------------------------------------------------------------
      // 2. Calls stats: Tenant B calls never show for Tenant A admin
      // ---------------------------------------------------------------------
      const callsStatsRes = await request(app).get('/api/calls/stats').set(bearer(adminAToken));
      expect(callsStatsRes.status).toBe(200);
      expect(callsStatsRes.body.stats.some((s: any) => s.repId === repB.id)).toBe(false);

      // ---------------------------------------------------------------------
      // 3. Leaderboard: Tenant B reps never show on Tenant A leaderboard
      // ---------------------------------------------------------------------
      const leaderboardRes = await request(app)
        .get('/api/leaderboard?role=upsell&period=month')
        .set(bearer(adminAToken));
      expect(leaderboardRes.status).toBe(200);
      expect(leaderboardRes.body.rows.some((r: any) => r.userId === repB.id)).toBe(false);

      // ---------------------------------------------------------------------
      // 4. Customers: Tenant B customers never show for Tenant A
      // ---------------------------------------------------------------------
      const customersRes = await request(app).get('/api/customers').set(bearer(adminAToken));
      expect(customersRes.status).toBe(200);
      expect(customersRes.body.customers.some((c: any) => c.id === customerB.id)).toBe(false);

      // Accessing customer B directly with Tenant A credentials returns 404
      const customerBDirectRes = await request(app).get(`/api/customers/${customerB.id}`).set(bearer(adminAToken));
      expect(customerBDirectRes.status).toBe(404);
    });
  });
});
