import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import crypto from 'crypto';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { makeOrder } from './helpers/kpiOrders';
import { clearWhatsAppConfigCache } from '../../services/whatsappService';

let pair: TwoTenants;
let tenantAId: string;
let tenantBId: string;
let customerAId: number;
let customerAPhone: string;

const phoneIdA = 'wa-phone-t09-a';
const secretA = 'wa-secret-t09-a';
const phoneIdB = 'wa-phone-t09-b';
const secretB = 'wa-secret-t09-b';

function sign(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function makePayload(
  phoneId: string,
  messageId: string,
  fromPhone: string,
  text: string,
  contextId?: string,
) {
  const messageObj: any = {
    from: fromPhone.replace(/^\+/, ''),
    id: messageId,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'text',
    text: { body: text },
  };
  if (contextId) {
    messageObj.context = { id: contextId, from: '15550001' };
  }

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
                  profile: { name: 'Test User' },
                  wa_id: fromPhone.replace(/^\+/, ''),
                },
              ],
              messages: [messageObj],
            },
          },
        ],
      },
    ],
  };
}

beforeAll(async () => {
  pair = await createTwoTenants('inbwa');
  tenantAId = pair.a.id;
  tenantBId = pair.b.id;
  customerAId = pair.a.ids.customer;
  customerAPhone = pair.a.phone;

  // Configure WhatsApp provider for Tenant A
  await prismaBase.systemConfig.upsert({
    where: { tenantId: tenantAId },
    create: {
      tenantId: tenantAId,
      whatsappProvider: {
        isEnabled: true,
        accessToken: 'tok-a',
        phoneNumberId: phoneIdA,
        appSecret: secretA,
        webhookVerifyToken: 'verify-a',
      } as any,
    },
    update: {
      whatsappProvider: {
        isEnabled: true,
        accessToken: 'tok-a',
        phoneNumberId: phoneIdA,
        appSecret: secretA,
        webhookVerifyToken: 'verify-a',
      } as any,
    },
  });

  // Configure WhatsApp provider for Tenant B
  await prismaBase.systemConfig.upsert({
    where: { tenantId: tenantBId },
    create: {
      tenantId: tenantBId,
      whatsappProvider: {
        isEnabled: true,
        accessToken: 'tok-b',
        phoneNumberId: phoneIdB,
        appSecret: secretB,
        webhookVerifyToken: 'verify-b',
      } as any,
    },
    update: {
      whatsappProvider: {
        isEnabled: true,
        accessToken: 'tok-b',
        phoneNumberId: phoneIdB,
        appSecret: secretB,
        webhookVerifyToken: 'verify-b',
      } as any,
    },
  });

  clearWhatsAppConfigCache();
}, 60000);

afterAll(async () => {
  clearWhatsAppConfigCache();
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('M7-T09: Inbound WhatsApp core integration tests', () => {
  it('rejects a payload with a bad signature (401) and stores nothing', async () => {
    const raw = JSON.stringify(makePayload(phoneIdA, 'wamid.bad.sig.1', customerAPhone, 'YES'));
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign('wrong-secret-key', raw))
      .send(raw);

    expect(res.status).toBe(401);

    const log = await prismaBase.messageLog.findFirst({
      where: { providerMessageId: 'wamid.bad.sig.1' },
    });
    expect(log).toBeNull();
  });

  it('routes webhook by phone_number_id to the correct tenant', async () => {
    const msgId = `wamid.route.b.${Date.now()}`;
    const raw = JSON.stringify(makePayload(phoneIdB, msgId, '+233999888777', 'Hello from B'));
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(secretB, raw))
      .send(raw);

    expect(res.status).toBe(200);

    const log = await prismaBase.messageLog.findFirst({
      where: { providerMessageId: msgId },
    });
    expect(log).not.toBeNull();
    expect(log!.tenantId).toBe(tenantBId);
    expect(log!.direction).toBe('inbound');
    expect(log!.messageBody).toBe('Hello from B');
  });

  it('inbound YES confirms an open auto-confirm order (no commission entry, no call row)', async () => {
    const order = await makeOrder({
      tenantId: tenantAId,
      customerId: customerAId,
      status: 'pending_confirmation',
      paymentMethod: 'cod',
      orderType: 'physical',
    });
    await prismaBase.order.update({
      where: { id: order.id },
      data: { autoConfirmSentAt: new Date() },
    });

    await prismaBase.confirmToken.create({
      data: {
        tenantId: tenantAId,
        orderId: order.id,
        token: `tok-yes-${Date.now()}`,
        channel: 'whatsapp',
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    const msgId = `wamid.yes.${Date.now()}`;
    const raw = JSON.stringify(makePayload(phoneIdA, msgId, customerAPhone, '  YES.  '));
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(secretA, raw))
      .send(raw);

    expect(res.status).toBe(200);

    // Verify order is confirmed
    const updatedOrder = await prismaBase.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(updatedOrder.status).toBe('confirmed');
    expect(updatedOrder.customerResponse).toBe('yes');
    expect(updatedOrder.confirmedAt).not.toBeNull();

    // Verify no call row was created
    const callCount = await prismaBase.call.count({
      where: { orderId: order.id },
    });
    expect(callCount).toBe(0);

    // Verify no commission entry was created
    const commissionCount = await prismaBase.commissionEntry.count({
      where: { orderId: order.id },
    });
    expect(commissionCount).toBe(0);

    // Verify ConfirmToken marked used
    const token = await prismaBase.confirmToken.findFirst({
      where: { orderId: order.id },
    });
    expect(token!.usedAt).not.toBeNull();
    expect(token!.response).toBe('yes');

    // Verify MessageLog was created with direction: inbound
    const log = await prismaBase.messageLog.findFirst({
      where: { providerMessageId: msgId },
    });
    expect(log).not.toBeNull();
    expect(log!.direction).toBe('inbound');
    expect(log!.channel).toBe('whatsapp');
    expect(log!.customerId).toBe(customerAId);
    expect(log!.orderId).toBe(order.id);
  });

  it('inbound NO sets saidNo=true, requiresManualCall=true, customerResponse=no, order stays open in queue', async () => {
    // Create another customer in Tenant A
    const customerNo = await prismaBase.customer.create({
      data: {
        tenantId: tenantAId,
        firstName: 'No',
        lastName: 'Customer',
        phoneNumber: '+233241999111',
        address: '123 Street',
        state: 'Greater Accra',
        area: 'Accra',
      },
    });

    const order = await makeOrder({
      tenantId: tenantAId,
      customerId: customerNo.id,
      status: 'pending_confirmation',
      paymentMethod: 'cod',
      orderType: 'physical',
    });
    await prismaBase.order.update({
      where: { id: order.id },
      data: { autoConfirmSentAt: new Date() },
    });

    await prismaBase.confirmToken.create({
      data: {
        tenantId: tenantAId,
        orderId: order.id,
        token: `tok-no-${Date.now()}`,
        channel: 'whatsapp',
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    const msgId = `wamid.no.${Date.now()}`;
    const raw = JSON.stringify(makePayload(phoneIdA, msgId, '+233241999111', 'No.'));
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(secretA, raw))
      .send(raw);

    expect(res.status).toBe(200);

    // Verify order is still pending_confirmation (open in queue)
    const updatedOrder = await prismaBase.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(updatedOrder.status).toBe('pending_confirmation');
    expect(updatedOrder.saidNo).toBe(true);
    expect(updatedOrder.requiresManualCall).toBe(true);
    expect(updatedOrder.customerResponse).toBe('no');

    // Verify no call row was created
    const callCount = await prismaBase.call.count({
      where: { orderId: order.id },
    });
    expect(callCount).toBe(0);

    // Verify no commission entry was created
    const commissionCount = await prismaBase.commissionEntry.count({
      where: { orderId: order.id },
    });
    expect(commissionCount).toBe(0);

    // Verify ConfirmToken marked used
    const token = await prismaBase.confirmToken.findFirst({
      where: { orderId: order.id },
    });
    expect(token!.usedAt).not.toBeNull();
    expect(token!.response).toBe('no');

    // Verify MessageLog recorded
    const log = await prismaBase.messageLog.findFirst({
      where: { providerMessageId: msgId },
    });
    expect(log).not.toBeNull();
    expect(log!.direction).toBe('inbound');
    expect(log!.customerId).toBe(customerNo.id);
    expect(log!.orderId).toBe(order.id);
  });

  it('inbound message from unknown phone number is stored in MessageLog, not dropped', async () => {
    const unknownPhone = '+233209876543';
    const msgId = `wamid.unknown.${Date.now()}`;
    const raw = JSON.stringify(makePayload(phoneIdA, msgId, unknownPhone, 'Hello, do you have sneakers?'));
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(secretA, raw))
      .send(raw);

    expect(res.status).toBe(200);

    const log = await prismaBase.messageLog.findFirst({
      where: { providerMessageId: msgId },
    });
    expect(log).not.toBeNull();
    expect(log!.tenantId).toBe(tenantAId);
    expect(log!.customerId).toBeNull();
    expect(log!.orderId).toBeNull();
    expect(log!.direction).toBe('inbound');
    expect(log!.channel).toBe('whatsapp');
    expect(log!.messageBody).toBe('Hello, do you have sneakers?');
  });

  it('duplicate webhook delivery with the same providerMessageId is idempotent', async () => {
    const msgId = `wamid.idempotent.${Date.now()}`;
    const raw = JSON.stringify(makePayload(phoneIdA, msgId, customerAPhone, 'YES'));

    // First delivery
    const res1 = await request(app)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(secretA, raw))
      .send(raw);
    expect(res1.status).toBe(200);

    // Duplicate delivery
    const res2 = await request(app)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(secretA, raw))
      .send(raw);
    expect(res2.status).toBe(200);

    // Exactly one row exists with this providerMessageId
    const count = await prismaBase.messageLog.count({
      where: { providerMessageId: msgId },
    });
    expect(count).toBe(1);
  });

  it('links inbound message to answered outbound message via context.id', async () => {
    const order = await makeOrder({
      tenantId: tenantAId,
      customerId: customerAId,
      status: 'pending_confirmation',
      paymentMethod: 'cod',
      orderType: 'physical',
    });
    await prismaBase.order.update({
      where: { id: order.id },
      data: { autoConfirmSentAt: new Date() },
    });

    const outboundMsgId = `wamid.outbound.${Date.now()}`;
    const outboundLog = await prismaBase.messageLog.create({
      data: {
        tenantId: tenantAId,
        customerId: customerAId,
        orderId: order.id,
        channel: 'whatsapp',
        direction: 'outbound',
        status: 'delivered',
        messageBody: 'Hello! Reply YES to confirm.',
        providerMessageId: outboundMsgId,
      },
    });

    const inboundMsgId = `wamid.reply.${Date.now()}`;
    const raw = JSON.stringify(makePayload(phoneIdA, inboundMsgId, customerAPhone, 'YES', outboundMsgId));
    const res = await request(app)
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(secretA, raw))
      .send(raw);

    expect(res.status).toBe(200);

    const inboundLog = await prismaBase.messageLog.findFirst({
      where: { providerMessageId: inboundMsgId },
    });
    expect(inboundLog).not.toBeNull();
    expect(inboundLog!.orderId).toBe(order.id);
    expect((inboundLog!.metadata as any)?.answeredMessageLogId).toBe(outboundLog.id);

    const updatedOrder = await prismaBase.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(updatedOrder.status).toBe('confirmed');
  });
});
