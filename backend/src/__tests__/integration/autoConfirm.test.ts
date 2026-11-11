import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { makeOrder } from './helpers/kpiOrders';
import { sendAutoConfirmForOrder } from '../../services/autoConfirmService';
import { whatsappService, clearWhatsAppConfigCache } from '../../services/whatsappService';
import { smsService } from '../../services/smsService';
import orderService from '../../services/orderService';
import { runInTenant } from '../../utils/tenantContext';
import workflowService from '../../services/workflowService';
import { workflowQueue, processExecuteWorkflow } from '../../queues/workflowQueue';
import { fullName } from '../../utils/nameUtils';
import * as Money from '../../utils/money';

let pair: TwoTenants;
let tenantId: string;
let customerId: number;

beforeAll(async () => {
  pair = await createTwoTenants('autoconf');
  tenantId = pair.a.id;
  customerId = pair.a.ids.customer;
}, 60000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('M7-T08: Auto-confirm send and public confirmation API', () => {
  it('an order created with no send_auto_confirm workflow sends nothing and creates no ConfirmToken', async () => {
    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'pending_confirmation',
      paymentMethod: 'cod',
      orderType: 'physical',
    });

    const sendWhatsAppSpy = jest.spyOn(whatsappService, 'sendTemplate').mockResolvedValue({ messageLogId: 1 } as any);
    const sendSmsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue('msg-id-1' as any);

    // The order.created path: no workflow row, so nothing runs
    await runInTenant(tenantId, () => workflowService.triggerOrderCreatedWorkflows({ id: order.id }));

    expect(sendWhatsAppSpy).not.toHaveBeenCalled();
    expect(sendSmsSpy).not.toHaveBeenCalled();

    const tokens = await prismaBase.confirmToken.findMany({ where: { orderId: order.id } });
    expect(tokens.length).toBe(0);

    const checkOrder = await prismaBase.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(checkOrder.autoConfirmSentAt).toBeNull();

    sendWhatsAppSpy.mockRestore();
    sendSmsSpy.mockRestore();
  });

  it('creates ConfirmToken, sets Order.autoConfirmSentAt, and sends exactly once with exact template params', async () => {
    const product = await prismaBase.product.create({
      data: { name: 'Acne Serum', sku: `AS-${Date.now()}`, price: 100, stockQuantity: 10, category: 'Health', tenantId },
    });

    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'pending_confirmation',
      paymentMethod: 'cod',
      orderType: 'physical',
      totalAmount: 100,
    });

    await prismaBase.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        quantity: 1,
        unitPrice: 100,
        totalPrice: 100,
        itemType: 'package',
        metadata: { packageName: '1 Bottle' },
      },
    });

    const sendWhatsAppSpy = jest.spyOn(whatsappService, 'sendTemplate').mockResolvedValue({ messageLogId: 2 } as any);

    const customer = await prismaBase.customer.findUniqueOrThrow({ where: { id: customerId } });
    const result = await sendAutoConfirmForOrder(order.id, tenantId);

    expect(result).not.toBeNull();
    expect(result?.channel).toBe('whatsapp');
    expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: order.id,
        customerId,
        templateName: 'order_auto_confirm',
        languageCode: 'en_US',
        headerParams: ['Acne Serum'],
        bodyParams: [
          fullName(customer),
          '1 Bottle',
          String(order.id),
          Money.formatWithSign(order.totalAmount, order.currency ?? 'GHS'),
        ],
        buttonPayloads: ['CONFIRM', 'CHANGE', 'CANCEL'],
      })
    );

    const updatedOrder = await prismaBase.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.autoConfirmSentAt).not.toBeNull();

    const token = await prismaBase.confirmToken.findUnique({ where: { token: result!.token } });
    expect(token).not.toBeNull();
    expect(token?.orderId).toBe(order.id);
    expect(token?.channel).toBe('whatsapp');

    // Exactly one send: second call must be a no-op
    const secondResult = await sendAutoConfirmForOrder(order.id, tenantId);
    expect(secondResult).toBeNull();
    expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1);

    sendWhatsAppSpy.mockRestore();
  });

  it('order with 2 items gives "<label> + 1 more item" in bodyParams', async () => {
    const product1 = await prismaBase.product.create({
      data: { name: 'Acne Serum', sku: `AS1-${Date.now()}`, price: 100, stockQuantity: 10, category: 'Health', tenantId },
    });
    const product2 = await prismaBase.product.create({
      data: { name: 'Facial Wash', sku: `FW1-${Date.now()}`, price: 50, stockQuantity: 10, category: 'Health', tenantId },
    });

    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'pending_confirmation',
      paymentMethod: 'cod',
      orderType: 'physical',
      totalAmount: 150,
    });

    await prismaBase.orderItem.create({
      data: {
        orderId: order.id,
        productId: product1.id,
        quantity: 2,
        unitPrice: 100,
        totalPrice: 100,
        itemType: 'package',
        metadata: { packageName: '2 Sets' },
      },
    });
    await prismaBase.orderItem.create({
      data: {
        orderId: order.id,
        productId: product2.id,
        quantity: 1,
        unitPrice: 50,
        totalPrice: 50,
        itemType: 'addon',
      },
    });

    const sendWhatsAppSpy = jest.spyOn(whatsappService, 'sendTemplate').mockResolvedValue({ messageLogId: 10 } as any);

    const customer = await prismaBase.customer.findUniqueOrThrow({ where: { id: customerId } });
    await sendAutoConfirmForOrder(order.id, tenantId);

    expect(sendWhatsAppSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        headerParams: ['Acne Serum'],
        bodyParams: [
          fullName(customer),
          '2 Sets + 1 more item',
          String(order.id),
          Money.formatWithSign(order.totalAmount, order.currency ?? 'GHS'),
        ],
      })
    );

    sendWhatsAppSpy.mockRestore();
  });

  it('SMS text starts with <businessName>: when systemConfig.businessName is set', async () => {
    await prismaBase.systemConfig.update({
      where: { tenantId },
      data: {
        businessName: 'Glow Cosmetics',
      },
    });

    try {
      const product = await prismaBase.product.create({
        data: { name: 'Glow Cream', sku: `GC-${Date.now()}`, price: 120, stockQuantity: 10, category: 'Health', tenantId },
      });

      const order = await makeOrder({
        tenantId,
        customerId,
        status: 'pending_confirmation',
        paymentMethod: 'cod',
        orderType: 'physical',
        totalAmount: 120,
      });

      await prismaBase.orderItem.create({
        data: {
          orderId: order.id,
          productId: product.id,
          quantity: 1,
          unitPrice: 120,
          totalPrice: 120,
          itemType: 'package',
        },
      });

      const sendSmsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue('sms-id-exact' as any);

      await sendAutoConfirmForOrder(order.id, tenantId, { channel: 'sms' });

      expect(sendSmsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringMatching(/^Glow Cosmetics: Hello /),
        })
      );

      sendSmsSpy.mockRestore();
    } finally {
      await prismaBase.systemConfig.update({
        where: { tenantId },
        data: { businessName: null },
      });
    }
  });

  it('a workflow in another tenant cannot send for this order', async () => {
    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'pending_confirmation',
      paymentMethod: 'cod',
      orderType: 'physical',
    });
    const waSpy = jest.spyOn(whatsappService, 'sendTemplate').mockResolvedValue({ messageLogId: 30 } as any);
    const smsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue('x' as any);

    const result = await sendAutoConfirmForOrder(order.id, 'some-other-tenant');

    expect(result).toBeNull();
    expect(waSpy).not.toHaveBeenCalled();
    expect(smsSpy).not.toHaveBeenCalled();
    const after = await prismaBase.order.findUnique({ where: { id: order.id } });
    expect(after!.autoConfirmSentAt).toBeNull();
    waSpy.mockRestore();
    smsSpy.mockRestore();
  });

  it('when WhatsApp and SMS both fail, the send throws and the order can be tried again', async () => {
    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'pending_confirmation',
      paymentMethod: 'cod',
      orderType: 'physical',
    });
    const waSpy = jest.spyOn(whatsappService, 'sendTemplate').mockRejectedValue(new Error('WhatsApp down'));
    const smsSpy = jest.spyOn(smsService, 'sendSms').mockRejectedValue(new Error('SMS down'));

    await expect(sendAutoConfirmForOrder(order.id, tenantId)).rejects.toThrow(/could not be sent/);

    const after = await prismaBase.order.findUnique({ where: { id: order.id } });
    expect(after!.autoConfirmSentAt).toBeNull();
    expect(await prismaBase.confirmToken.count({ where: { orderId: order.id } })).toBe(0);
    waSpy.mockRestore();
    smsSpy.mockRestore();
  });

  it('releases the claim when neither channel is set up (send only logged)', async () => {
    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'pending_confirmation',
      paymentMethod: 'cod',
      orderType: 'physical',
    });
    const savedToken = process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    clearWhatsAppConfigCache();
    try {
      // No spies: the real services find no config, log the message as pending and send nothing.
      await expect(sendAutoConfirmForOrder(order.id, tenantId)).rejects.toThrow(/could not be sent/);
    } finally {
      if (savedToken !== undefined) process.env.WHATSAPP_ACCESS_TOKEN = savedToken;
      clearWhatsAppConfigCache();
    }

    const after = await prismaBase.order.findUnique({ where: { id: order.id } });
    expect(after!.autoConfirmSentAt).toBeNull();
    expect(await prismaBase.confirmToken.count({ where: { orderId: order.id } })).toBe(0);
    const logs = await prismaBase.messageLog.findMany({ where: { orderId: order.id }, select: { channel: true, status: true } });
    expect(logs.map((l) => l.channel).sort()).toEqual(['sms', 'whatsapp']);
    expect(logs.every((l) => l.status === 'pending')).toBe(true);
  });

  it('WhatsApp failure falls back to SMS', async () => {
    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'pending_confirmation',
      paymentMethod: 'cod',
      orderType: 'physical',
    });

    const sendWhatsAppSpy = jest.spyOn(whatsappService, 'sendTemplate').mockRejectedValue(new Error('WhatsApp connection error'));
    const sendSmsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue('sms-fallback-id' as any);

    const result = await sendAutoConfirmForOrder(order.id, tenantId);

    expect(result).not.toBeNull();
    expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1);
    expect(sendSmsSpy).toHaveBeenCalledTimes(1);
    expect(sendSmsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringMatching(/please confirm order #\d+, .+, GHS \d+\.\d{2} on delivery\. Reply YES to confirm or NO to change or cancel\./),
      })
    );

    sendWhatsAppSpy.mockRestore();
    sendSmsSpy.mockRestore();
  });

  describe('send_auto_confirm workflow action (COD-193 M7-R2)', () => {
    const mkAutoConfirmWorkflow = (channel?: 'sms' | 'whatsapp') =>
      prismaBase.workflow.create({
        data: {
          name: `auto-confirm ${Date.now()}`,
          triggerType: 'order_created',
          triggerData: {},
          actions: [{ type: 'send_auto_confirm', config: channel ? { channel } : {} }],
          isActive: true,
          tenantId,
        },
      });
    const mkPending = () =>
      makeOrder({ tenantId, customerId, status: 'pending_confirmation', paymentMethod: 'cod', orderType: 'physical' });
    const runCreated = (orderId: number) =>
      runInTenant(tenantId, () => workflowService.triggerOrderCreatedWorkflows({ id: orderId }));

    beforeEach(() => {
      // Run the job at once, the way the Bull worker would later
      jest.spyOn(workflowQueue, 'add').mockImplementation((async (_name: string, data: any) => {
        await processExecuteWorkflow({ id: 'inline', data } as any);
      }) as any);
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await prismaBase.workflow.deleteMany({ where: { tenantId } });
    });

    it('order_created workflow sends the template once; a second run is skipped', async () => {
      await mkAutoConfirmWorkflow();
      const order = await mkPending();
      const waSpy = jest.spyOn(whatsappService, 'sendTemplate').mockResolvedValue({ messageLogId: 21 } as any);
      const smsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue('sms-x' as any);

      await runCreated(order.id);
      expect(waSpy).toHaveBeenCalledTimes(1);
      expect(waSpy).toHaveBeenCalledWith(expect.objectContaining({ templateName: 'order_auto_confirm', orderId: order.id }));
      expect(await prismaBase.confirmToken.count({ where: { orderId: order.id } })).toBe(1);

      await runCreated(order.id);
      expect(waSpy).toHaveBeenCalledTimes(1);
      expect(smsSpy).not.toHaveBeenCalled();
      expect(await prismaBase.confirmToken.count({ where: { orderId: order.id } })).toBe(1);
    });

    it("config channel 'sms' sends the SMS text, not the template", async () => {
      await mkAutoConfirmWorkflow('sms');
      const order = await mkPending();
      const waSpy = jest.spyOn(whatsappService, 'sendTemplate').mockResolvedValue({ messageLogId: 22 } as any);
      const smsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue('sms-y' as any);

      await runCreated(order.id);
      expect(waSpy).not.toHaveBeenCalled();
      expect(smsSpy).toHaveBeenCalledTimes(1);
      expect(smsSpy).toHaveBeenCalledWith(
        expect.objectContaining({ body: expect.stringMatching(/please confirm order #\d+/) }),
      );
      const token = await prismaBase.confirmToken.findFirstOrThrow({ where: { orderId: order.id } });
      expect(token.channel).toBe('sms');
    });
  });

  it('GET /api/public/confirm/:token returns summary with no private data', async () => {
    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'pending_confirmation',
      deliveryAddress: 'House 42, Ring Road',
      deliveryArea: 'Osu',
      deliveryState: 'Greater Accra',
    });

    const tokenRecord = await prismaBase.confirmToken.create({
      data: {
        tenantId,
        orderId: order.id,
        token: 'test-token-summary-123',
        channel: 'whatsapp',
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
      },
    });

    const res = await request(app).get(`/api/public/confirm/${tokenRecord.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      orderId: order.id,
      status: 'pending_confirmation',
      deliveryAddress: order.deliveryAddress,
      deliveryArea: order.deliveryArea,
    });
    // Private data must not be returned
    expect(res.body.cogs).toBeUndefined();
    expect(res.body.margin).toBeUndefined();
    expect(res.body.internalNotes).toBeUndefined();
    expect(res.body.commissionAmount).toBeUndefined();
  });

  it('GET /api/public/confirm/:token returns 410 if expired or used', async () => {
    const order = await makeOrder({ tenantId, customerId, status: 'pending_confirmation' });

    const expiredToken = await prismaBase.confirmToken.create({
      data: {
        tenantId,
        orderId: order.id,
        token: 'test-token-expired-456',
        channel: 'sms',
        expiresAt: new Date(Date.now() - 1000), // In the past
      },
    });

    const resExpired = await request(app).get(`/api/public/confirm/${expiredToken.token}`);
    expect(resExpired.status).toBe(410);

    const usedToken = await prismaBase.confirmToken.create({
      data: {
        tenantId,
        orderId: order.id,
        token: 'test-token-used-789',
        channel: 'whatsapp',
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
        usedAt: new Date(),
        response: 'yes',
      },
    });

    const resUsed = await request(app).get(`/api/public/confirm/${usedToken.token}`);
    expect(resUsed.status).toBe(410);
  });

  it('POST /api/public/confirm/:token with action: yes confirms order, creates 0 commission entries, 0 call rows', async () => {
    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'pending_confirmation',
      paymentMethod: 'cod',
    });

    const tokenRecord = await prismaBase.confirmToken.create({
      data: {
        tenantId,
        orderId: order.id,
        token: 'test-token-yes-confirm',
        channel: 'whatsapp',
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
      },
    });

    const res = await request(app).post(`/api/public/confirm/${tokenRecord.token}`).send({ action: 'yes' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');

    const updatedOrder = await prismaBase.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updatedOrder.status).toBe('confirmed');
    expect(updatedOrder.customerResponse).toBe('yes');
    expect(updatedOrder.confirmedAt).not.toBeNull();
    expect(updatedOrder.firstContactAt).not.toBeNull();

    // Verify: NO commission entries created!
    const commissionEntries = await prismaBase.commissionEntry.findMany({ where: { orderId: order.id } });
    expect(commissionEntries.length).toBe(0);

    // Verify: NO call rows created!
    const calls = await prismaBase.call.findMany({ where: { orderId: order.id } });
    expect(calls.length).toBe(0);

    // Token marked used with response 'yes'
    const updatedToken = await prismaBase.confirmToken.findUniqueOrThrow({ where: { id: tokenRecord.id } });
    expect(updatedToken.usedAt).not.toBeNull();
    expect(updatedToken.response).toBe('yes');

    // A second YES is ignored (200, no change)
    const secondRes = await request(app).post(`/api/public/confirm/${tokenRecord.token}`).send({ action: 'yes' });
    expect(secondRes.status).toBe(200);
    expect(secondRes.body.status).toBe('confirmed');
  });

  it('POST /api/public/confirm/:token reply after order is cancelled is ignored and logged', async () => {
    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'cancelled',
    });

    const tokenRecord = await prismaBase.confirmToken.create({
      data: {
        tenantId,
        orderId: order.id,
        token: 'test-token-cancelled-reply',
        channel: 'whatsapp',
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
      },
    });

    const res = await request(app).post(`/api/public/confirm/${tokenRecord.token}`).send({ action: 'yes' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');

    const checkOrder = await prismaBase.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(checkOrder.status).toBe('cancelled');
    expect(checkOrder.customerResponse).toBeNull();
  });

  it('shipped (out_for_delivery) order, then YES: no error, no change', async () => {
    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'out_for_delivery',
    });

    // Direct service call: returns order, no change, no error
    const directRes = await runInTenant(tenantId, () => orderService.confirmByCustomer(order.id));
    expect(directRes?.status).toBe('out_for_delivery');

    const tokenRecord = await prismaBase.confirmToken.create({
      data: {
        tenantId,
        orderId: order.id,
        token: 'test-token-shipped-reply',
        channel: 'whatsapp',
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
      },
    });

    // Public POST endpoint: token marked used, status returned, order unchanged
    const res = await request(app).post(`/api/public/confirm/${tokenRecord.token}`).send({ action: 'yes' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('out_for_delivery');

    const checkOrder = await prismaBase.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(checkOrder.status).toBe('out_for_delivery');
    expect(checkOrder.customerResponse).toBeNull();

    const checkToken = await prismaBase.confirmToken.findUniqueOrThrow({ where: { id: tokenRecord.id } });
    expect(checkToken.usedAt).not.toBeNull();
    expect(checkToken.response).toBe('yes');
  });

  it('POST /api/public/confirm/:token accepts only yes and change; anything else is 400', async () => {
    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'pending_confirmation',
    });

    const tokenRecord = await prismaBase.confirmToken.create({
      data: {
        tenantId,
        orderId: order.id,
        token: 'test-token-invalid-actions',
        channel: 'whatsapp',
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
      },
    });

    // action: no is rejected with 400
    const resNo = await request(app).post(`/api/public/confirm/${tokenRecord.token}`).send({ action: 'no' });
    expect(resNo.status).toBe(400);

    // action: confirm is rejected with 400
    const resConfirm = await request(app).post(`/api/public/confirm/${tokenRecord.token}`).send({ action: 'confirm' });
    expect(resConfirm.status).toBe(400);

    // token should remain unused
    const checkToken = await prismaBase.confirmToken.findUniqueOrThrow({ where: { id: tokenRecord.id } });
    expect(checkToken.usedAt).toBeNull();
  });

  it('POST /api/public/confirm/:token with action: change sets customerResponse=change, requiresManualCall=true, order stays pending_confirmation, token marked used', async () => {
    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'pending_confirmation',
    });

    const tokenRecord = await prismaBase.confirmToken.create({
      data: {
        tenantId,
        orderId: order.id,
        token: 'test-token-change-reply',
        channel: 'whatsapp',
        expiresAt: new Date(Date.now() + 48 * 3600 * 1000),
      },
    });

    const res = await request(app).post(`/api/public/confirm/${tokenRecord.token}`).send({ action: 'change' });
    expect(res.status).toBe(200);

    const checkOrder = await prismaBase.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(checkOrder.status).toBe('pending_confirmation');
    expect(checkOrder.customerResponse).toBe('change');
    expect(checkOrder.requiresManualCall).toBe(true);

    const checkToken = await prismaBase.confirmToken.findUniqueOrThrow({ where: { id: tokenRecord.id } });
    expect(checkToken.usedAt).not.toBeNull();
    expect(checkToken.response).toBe('change');
  });
});
