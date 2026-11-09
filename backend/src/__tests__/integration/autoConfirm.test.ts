import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { makeOrder } from './helpers/kpiOrders';
import { sendAutoConfirmForOrder } from '../../services/autoConfirmService';
import { whatsappService } from '../../services/whatsappService';
import { smsService } from '../../services/smsService';
import orderService from '../../services/orderService';
import { runInTenant } from '../../utils/tenantContext';

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
  it('disabled setting sends nothing and creates no ConfirmToken', async () => {
    // Ensure autoConfirmEnabled is false
    await prismaBase.systemConfig.update({
      where: { tenantId },
      data: { autoConfirmEnabled: false },
    });

    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'pending_confirmation',
      paymentMethod: 'cod',
      orderType: 'physical',
    });

    const sendWhatsAppSpy = jest.spyOn(whatsappService, 'sendText').mockResolvedValue({ messageLogId: 1 } as any);
    const sendSmsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue('msg-id-1' as any);

    const result = await sendAutoConfirmForOrder(order.id, tenantId);

    expect(result).toBeNull();
    expect(sendWhatsAppSpy).not.toHaveBeenCalled();
    expect(sendSmsSpy).not.toHaveBeenCalled();

    const tokens = await prismaBase.confirmToken.findMany({ where: { orderId: order.id } });
    expect(tokens.length).toBe(0);

    const checkOrder = await prismaBase.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(checkOrder.autoConfirmSentAt).toBeNull();

    sendWhatsAppSpy.mockRestore();
    sendSmsSpy.mockRestore();
  });

  it('enabled setting creates ConfirmToken, sets Order.autoConfirmSentAt, and sends exactly once', async () => {
    await prismaBase.systemConfig.update({
      where: { tenantId },
      data: { autoConfirmEnabled: true, autoConfirmChannel: 'whatsapp' },
    });

    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'pending_confirmation',
      paymentMethod: 'cod',
      orderType: 'physical',
    });

    const sendWhatsAppSpy = jest.spyOn(whatsappService, 'sendText').mockResolvedValue({ messageLogId: 2 } as any);

    const result = await sendAutoConfirmForOrder(order.id, tenantId);

    expect(result).not.toBeNull();
    expect(result?.channel).toBe('whatsapp');
    expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: order.id,
        customerId,
        body: expect.stringMatching(/^Hello .+ thank you for your order #\d+ of [A-Z]{3} \d+\.\d{2}\. Reply YES to confirm it\. Reply NO if you want to change or cancel, and our team will call you\.$/),
      })
    );
    const sentBody = (sendWhatsAppSpy.mock.calls[0][0] as any).body;
    expect(sentBody).toContain('Reply YES to confirm it. Reply NO if you want to change or cancel, and our team will call you.');
    expect(sentBody).not.toContain('/c/');

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

  it('WhatsApp failure falls back to SMS', async () => {
    await prismaBase.systemConfig.update({
      where: { tenantId },
      data: { autoConfirmEnabled: true, autoConfirmChannel: 'whatsapp' },
    });

    const order = await makeOrder({
      tenantId,
      customerId,
      status: 'pending_confirmation',
      paymentMethod: 'cod',
      orderType: 'physical',
    });

    const sendWhatsAppSpy = jest.spyOn(whatsappService, 'sendText').mockRejectedValue(new Error('WhatsApp connection error'));
    const sendSmsSpy = jest.spyOn(smsService, 'sendSms').mockResolvedValue('sms-fallback-id' as any);

    const result = await sendAutoConfirmForOrder(order.id, tenantId);

    expect(result).not.toBeNull();
    expect(sendWhatsAppSpy).toHaveBeenCalledTimes(1);
    expect(sendSmsSpy).toHaveBeenCalledTimes(1);

    sendWhatsAppSpy.mockRestore();
    sendSmsSpy.mockRestore();
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
