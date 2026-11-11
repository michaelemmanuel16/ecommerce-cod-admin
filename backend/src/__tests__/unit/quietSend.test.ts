/**
 * COD-193: a send that returns `sent: false` (channel not set up, message log stays pending) is never shown or
 * counted as sent. Workflow actions fail, bulk sends count it as failed, test endpoints answer 409.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../server', () => {
  const m = { emit: jest.fn(), to: jest.fn() };
  m.to.mockReturnValue(m);
  return { io: m };
});

const sendTemplate = jest.fn<(...a: any[]) => Promise<any>>();
const sendWhatsAppForOrder = jest.fn<(...a: any[]) => Promise<any>>();
jest.mock('../../services/whatsappService', () => ({
  __esModule: true,
  default: { sendTemplate: (...a: any[]) => sendTemplate(...a) },
  sendWhatsAppForOrder: (...a: any[]) => sendWhatsAppForOrder(...a),
  ORDER_STATUS_TEMPLATES: { confirmed: { templateName: 'order_confirmed', bodyParams: jest.fn() } },
  TEMPLATE_BY_NAME: { order_confirmed: { templateName: 'order_confirmed', bodyParams: () => ['x'] } },
  getDbWhatsappConfig: jest.fn(),
  resolveWhatsappTenantFromPayload: jest.fn(),
  findWhatsappConfigByVerifyToken: jest.fn(),
}));

const sendSms = jest.fn<(...a: any[]) => Promise<any>>();
jest.mock('../../services/smsService', () => ({
  __esModule: true,
  smsService: { sendSms: (...a: any[]) => sendSms(...a) },
  getDbSmsConfig: jest.fn(async () => ({ isEnabled: true })),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prismaMock } from '../mocks/prisma.mock';
import { useTestTenant } from '../mocks/tenant.mock';
import { getDbSmsConfig } from '../../services/smsService';
import { WorkflowService } from '../../services/workflowService';
import { communicationService } from '../../services/communicationService';
import { executeAction } from '../../queues/workflowQueue';
import { testSend as smsTestSend } from '../../controllers/smsController';
import { testSend as whatsappTestSend } from '../../controllers/whatsappController';

const notSent = { messageLogId: 7, sent: false };

const mockRes = () => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('COD-193 quiet send: sent=false is never reported as sent', () => {
  useTestTenant();

  beforeEach(() => {
    jest.clearAllMocks();
    (getDbSmsConfig as jest.Mock).mockResolvedValue({ isEnabled: true } as never);
    sendSms.mockResolvedValue(notSent);
    sendTemplate.mockResolvedValue(notSent);
    sendWhatsAppForOrder.mockResolvedValue(notSent);
  });

  describe('workflow send actions fail', () => {
    it('queue send_sms throws when SMS is not set up', async () => {
      await expect(
        executeAction({ type: 'send_sms', config: { to: '0241234567', message: 'Hi' } }, { orderId: 1 }),
      ).rejects.toThrow('SMS is not set up: message not sent');
    });

    it('queue send_whatsapp throws when WhatsApp is not set up', async () => {
      await expect(
        executeAction({ type: 'send_whatsapp', config: { templateKey: 'confirmed' } }, { orderId: 1 }),
      ).rejects.toThrow('WhatsApp is not set up: message not sent');
    });

    it('queue send_whatsapp keeps an opted-out customer as a quiet success', async () => {
      sendWhatsAppForOrder.mockResolvedValue({ messageLogId: 0 });
      await expect(
        executeAction({ type: 'send_whatsapp', config: { templateKey: 'confirmed' } }, { orderId: 1 }),
      ).resolves.toEqual({ sent: true, messageLogId: 0 });
    });

    it('service send_sms and send_whatsapp throw too', async () => {
      const svc = new WorkflowService() as any;
      await expect(svc.executeSendSMS({ phoneNumber: '0241234567', message: 'Hi' }, { orderId: 1 }))
        .rejects.toThrow('SMS is not set up: message not sent');
      await expect(svc.executeSendWhatsApp({ config: { templateKey: 'confirmed' } }, { orderId: 1 }))
        .rejects.toThrow('WhatsApp is not set up: message not sent');
    });
  });

  describe('bulk sends count it as failed', () => {
    it('bulkSendSms', async () => {
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue([{ id: 1, phoneNumber: '+233241111111' }] as never);
      const r = await communicationService.bulkSendSms([1], 'Hello');
      expect(r.results[0]).toMatchObject({ customerId: 1, success: false, error: 'not set up' });
    });

    it('bulkSendWhatsApp', async () => {
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue(
        [{ id: 1, firstName: 'A', lastName: 'B', phoneNumber: '+233241111111' }] as never);
      const r = await communicationService.bulkSendWhatsApp([1], 'confirmed');
      expect(r.results[0]).toMatchObject({ customerId: 1, success: false, error: 'not set up' });
    });
  });

  describe('test-message endpoints answer 409', () => {
    it('SMS', async () => {
      const res = mockRes();
      await smsTestSend({ body: { phoneNumber: '0241234567' } } as any, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ error: 'SMS is not set up' });
    });

    it('WhatsApp', async () => {
      const res = mockRes();
      await whatsappTestSend({ body: { to: '0241234567' } } as any, res);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({ error: 'WhatsApp is not set up' });
    });
  });
});
