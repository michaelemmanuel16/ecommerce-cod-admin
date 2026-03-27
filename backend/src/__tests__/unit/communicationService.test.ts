import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock server module to prevent it from starting
jest.mock('../../server', () => {
  const m = { emit: jest.fn(), to: jest.fn() };
  m.to.mockReturnValue(m);
  return { io: m };
});

// Mock whatsappService
jest.mock('../../services/whatsappService', () => ({
  __esModule: true,
  default: {
    getMessages: jest.fn(),
    getStats: jest.fn(),
    sendTemplate: jest.fn(),
  },
  ORDER_STATUS_TEMPLATES: {
    confirmed: {
      templateName: 'order_confirmed',
      bodyParams: jest.fn(),
    },
  },
}));

// Mock smsService
jest.mock('../../services/smsService', () => ({
  __esModule: true,
  smsService: {
    sendSms: jest.fn(),
  },
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { prismaMock } from '../mocks/prisma.mock';
import { communicationService } from '../../services/communicationService';
import whatsappService from '../../services/whatsappService';
import { smsService } from '../../services/smsService';

describe('CommunicationService', () => {
  describe('getMessages', () => {
    it('should delegate to whatsappService.getMessages with params', async () => {
      const mockResult = {
        data: [{ id: 1, messageBody: 'hello' }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      };
      (whatsappService.getMessages as jest.Mock).mockResolvedValue(mockResult);

      const params = { page: 1, limit: 10, channel: 'sms' as any };
      const result = await communicationService.getMessages(params);

      expect(whatsappService.getMessages).toHaveBeenCalledWith(params);
      expect(result).toEqual(mockResult);
    });

    it('should pass date range filters', async () => {
      (whatsappService.getMessages as jest.Mock).mockResolvedValue({ data: [], pagination: {} });

      const params = { startDate: '2026-01-01', endDate: '2026-01-31' };
      await communicationService.getMessages(params);

      expect(whatsappService.getMessages).toHaveBeenCalledWith(params);
    });
  });

  describe('getStats', () => {
    it('should delegate to whatsappService.getStats', async () => {
      const mockStats = { total: 50, byStatus: { sent: 30, delivered: 20 }, byChannel: { sms: 20, whatsapp: 30 } };
      (whatsappService.getStats as jest.Mock).mockResolvedValue(mockStats);

      const result = await communicationService.getStats('2026-01-01', '2026-01-31');

      expect(whatsappService.getStats).toHaveBeenCalledWith('2026-01-01', '2026-01-31');
      expect(result).toEqual(mockStats);
    });

    it('should work without date params', async () => {
      (whatsappService.getStats as jest.Mock).mockResolvedValue({ total: 0, byStatus: {}, byChannel: {} });

      await communicationService.getStats();

      expect(whatsappService.getStats).toHaveBeenCalledWith(undefined, undefined);
    });
  });

  describe('getRecipients', () => {
    const mockCustomers = [
      { id: 1, firstName: 'John', lastName: 'Doe', phoneNumber: '+233241111111', state: 'Greater Accra', area: 'Accra', smsOptOut: false, whatsappOptOut: false },
      { id: 2, firstName: 'Jane', lastName: 'Smith', phoneNumber: '+233242222222', state: 'Greater Accra', area: 'Tema', smsOptOut: false, whatsappOptOut: false },
    ];

    it('should return customers filtered for SMS channel (excluding smsOptOut)', async () => {
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue(mockCustomers);

      const result = await communicationService.getRecipients({ channel: 'sms' });

      expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true, smsOptOut: false }),
        }),
      );
      expect(result).toEqual(mockCustomers);
    });

    it('should return customers filtered for WhatsApp channel (excluding whatsappOptOut)', async () => {
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue(mockCustomers);

      const result = await communicationService.getRecipients({ channel: 'whatsapp' });

      expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true, whatsappOptOut: false }),
        }),
      );
      expect(result).toEqual(mockCustomers);
    });

    it('should filter by state', async () => {
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue(mockCustomers);

      await communicationService.getRecipients({ channel: 'sms', state: 'Greater Accra' });

      expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ state: 'Greater Accra' }),
        }),
      );
    });

    it('should filter by product purchases', async () => {
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue([mockCustomers[0]]);

      await communicationService.getRecipients({ channel: 'sms', productId: 5 });

      expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orders: { some: { orderItems: { some: { productId: 5 } } } },
          }),
        }),
      );
    });

    it('should filter by hasOrdered', async () => {
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue(mockCustomers);

      await communicationService.getRecipients({ channel: 'whatsapp', hasOrdered: true });

      expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ totalOrders: { gt: 0 } }),
        }),
      );
    });
  });

  describe('bulkSendSms', () => {
    it('should filter out opted-out customers and send to remaining', async () => {
      const activeCustomers = [
        { id: 1, phoneNumber: '+233241111111' },
        { id: 2, phoneNumber: '+233242222222' },
      ];
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue(activeCustomers);
      (smsService.sendSms as jest.Mock)
        .mockResolvedValueOnce({ messageLogId: 101 })
        .mockResolvedValueOnce({ messageLogId: 102 });

      const result = await communicationService.bulkSendSms([1, 2, 3], 'Hello!');

      // Should query only non-opted-out, active customers
      expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2, 3] }, smsOptOut: false, isActive: true },
        select: { id: true, phoneNumber: true },
      });

      expect(smsService.sendSms).toHaveBeenCalledTimes(2);
      expect(result.total).toBe(2);
      expect(result.results).toHaveLength(2);
      expect(result.results[0]).toEqual({ customerId: 1, success: true, messageLogId: 101 });
      expect(result.results[1]).toEqual({ customerId: 2, success: true, messageLogId: 102 });
    });

    it('should handle individual send failures gracefully', async () => {
      const activeCustomers = [
        { id: 1, phoneNumber: '+233241111111' },
        { id: 2, phoneNumber: '+233242222222' },
      ];
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue(activeCustomers);
      (smsService.sendSms as jest.Mock)
        .mockResolvedValueOnce({ messageLogId: 101 })
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await communicationService.bulkSendSms([1, 2], 'Hello!');

      expect(result.total).toBe(2);
      expect(result.results[0]).toEqual({ customerId: 1, success: true, messageLogId: 101 });
      expect(result.results[1]).toEqual({ customerId: 2, success: false, error: 'Network error' });
    });

    it('should return empty results when all customers are opted out', async () => {
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue([]);

      const result = await communicationService.bulkSendSms([1, 2], 'Hello!');

      expect(smsService.sendSms).not.toHaveBeenCalled();
      expect(result.total).toBe(0);
      expect(result.results).toHaveLength(0);
    });
  });

  describe('bulkSendWhatsApp', () => {
    it('should filter out opted-out customers and send templates to remaining', async () => {
      const activeCustomers = [
        { id: 1, firstName: 'John', lastName: 'Doe', phoneNumber: '+233241111111' },
      ];
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue(activeCustomers);
      (whatsappService.sendTemplate as jest.Mock).mockResolvedValue({ messageLogId: 201 });

      const result = await communicationService.bulkSendWhatsApp([1, 2], 'confirmed');

      expect(prismaMock.customer.findMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2] }, whatsappOptOut: false, isActive: true },
        select: { id: true, firstName: true, lastName: true, phoneNumber: true },
      });

      expect(whatsappService.sendTemplate).toHaveBeenCalledWith({
        to: '+233241111111',
        templateName: 'order_confirmed',
        bodyParams: ['John Doe', 'your order'],
        customerId: 1,
      });
      expect(result.total).toBe(1);
      expect(result.results[0]).toEqual({ customerId: 1, success: true, messageLogId: 201 });
    });

    it('should append customLink to bodyParams when provided', async () => {
      const activeCustomers = [
        { id: 1, firstName: 'Jane', lastName: 'Smith', phoneNumber: '+233242222222' },
      ];
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue(activeCustomers);
      (whatsappService.sendTemplate as jest.Mock).mockResolvedValue({ messageLogId: 202 });

      await communicationService.bulkSendWhatsApp([1], 'confirmed', 'https://example.com');

      expect(whatsappService.sendTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          bodyParams: ['Jane Smith', 'your order', 'https://example.com'],
        }),
      );
    });

    it('should throw for unknown template key', async () => {
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue([{ id: 1, firstName: 'A', lastName: 'B', phoneNumber: '123' }]);

      await expect(communicationService.bulkSendWhatsApp([1], 'nonexistent_template'))
        .rejects.toThrow('Unknown WhatsApp template: nonexistent_template');
    });

    it('should handle individual send failures gracefully', async () => {
      const activeCustomers = [
        { id: 1, firstName: 'John', lastName: 'Doe', phoneNumber: '+233241111111' },
        { id: 2, firstName: 'Jane', lastName: 'Smith', phoneNumber: '+233242222222' },
      ];
      (prismaMock.customer.findMany as jest.Mock).mockResolvedValue(activeCustomers);
      (whatsappService.sendTemplate as jest.Mock)
        .mockResolvedValueOnce({ messageLogId: 201 })
        .mockRejectedValueOnce(new Error('API rate limit'));

      const result = await communicationService.bulkSendWhatsApp([1, 2], 'confirmed');

      expect(result.total).toBe(2);
      expect(result.results[0]).toEqual({ customerId: 1, success: true, messageLogId: 201 });
      expect(result.results[1]).toEqual({ customerId: 2, success: false, error: 'API rate limit' });
    });
  });

  describe('Template CRUD', () => {
    describe('getTemplates', () => {
      it('should return all templates ordered by createdAt desc', async () => {
        const mockTemplates = [
          { id: 2, name: 'Welcome', body: 'Welcome {{name}}!', createdAt: new Date() },
          { id: 1, name: 'Promo', body: 'Check this out!', createdAt: new Date() },
        ];
        (prismaMock.smsTemplate.findMany as jest.Mock).mockResolvedValue(mockTemplates);

        const result = await communicationService.getTemplates();

        expect(prismaMock.smsTemplate.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
        expect(result).toEqual(mockTemplates);
      });
    });

    describe('createTemplate', () => {
      it('should create a new template', async () => {
        const templateData = { name: 'New Template', body: 'Hello {{name}}!' };
        const mockCreated = { id: 1, ...templateData, createdAt: new Date(), updatedAt: new Date() };
        (prismaMock.smsTemplate.create as jest.Mock).mockResolvedValue(mockCreated);

        const result = await communicationService.createTemplate(templateData);

        expect(prismaMock.smsTemplate.create).toHaveBeenCalledWith({ data: templateData });
        expect(result).toEqual(mockCreated);
      });
    });

    describe('updateTemplate', () => {
      it('should update an existing template', async () => {
        const updateData = { name: 'Updated Name' };
        const mockUpdated = { id: 1, name: 'Updated Name', body: 'original body', createdAt: new Date(), updatedAt: new Date() };
        (prismaMock.smsTemplate.update as jest.Mock).mockResolvedValue(mockUpdated);

        const result = await communicationService.updateTemplate(1, updateData);

        expect(prismaMock.smsTemplate.update).toHaveBeenCalledWith({ where: { id: 1 }, data: updateData });
        expect(result).toEqual(mockUpdated);
      });
    });

    describe('deleteTemplate', () => {
      it('should delete a template by id', async () => {
        (prismaMock.smsTemplate.delete as jest.Mock).mockResolvedValue({ id: 1 });

        await communicationService.deleteTemplate(1);

        expect(prismaMock.smsTemplate.delete).toHaveBeenCalledWith({ where: { id: 1 } });
      });
    });
  });

  describe('Opt-out management', () => {
    describe('getOptOutCustomers', () => {
      it('should return paginated opt-out customers', async () => {
        const mockCustomers = [
          { id: 1, firstName: 'John', lastName: 'Doe', phoneNumber: '+233241111111', smsOptOut: true, whatsappOptOut: false },
        ];
        (prismaMock.customer.findMany as jest.Mock).mockResolvedValue(mockCustomers);
        (prismaMock.customer.count as jest.Mock).mockResolvedValue(1);

        const result = await communicationService.getOptOutCustomers(1, 20);

        expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { OR: [{ smsOptOut: true }, { whatsappOptOut: true }] },
            skip: 0,
            take: 20,
          }),
        );
        expect(result.customers).toEqual(mockCustomers);
        expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
      });

      it('should use default pagination values', async () => {
        (prismaMock.customer.findMany as jest.Mock).mockResolvedValue([]);
        (prismaMock.customer.count as jest.Mock).mockResolvedValue(0);

        const result = await communicationService.getOptOutCustomers();

        expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 0, take: 20 }),
        );
        expect(result.pagination).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
      });

      it('should calculate pagination for page 2', async () => {
        (prismaMock.customer.findMany as jest.Mock).mockResolvedValue([]);
        (prismaMock.customer.count as jest.Mock).mockResolvedValue(25);

        const result = await communicationService.getOptOutCustomers(2, 10);

        expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ skip: 10, take: 10 }),
        );
        expect(result.pagination).toEqual({ page: 2, limit: 10, total: 25, totalPages: 3 });
      });
    });

    describe('updateCustomerOptOut', () => {
      it('should update customer smsOptOut flag', async () => {
        const mockUpdated = { id: 1, smsOptOut: true, whatsappOptOut: false };
        (prismaMock.customer.update as jest.Mock).mockResolvedValue(mockUpdated);

        const result = await communicationService.updateCustomerOptOut(1, { smsOptOut: true });

        expect(prismaMock.customer.update).toHaveBeenCalledWith({
          where: { id: 1 },
          data: { smsOptOut: true },
        });
        expect(result).toEqual(mockUpdated);
      });

      it('should update customer whatsappOptOut flag', async () => {
        const mockUpdated = { id: 1, smsOptOut: false, whatsappOptOut: true };
        (prismaMock.customer.update as jest.Mock).mockResolvedValue(mockUpdated);

        const result = await communicationService.updateCustomerOptOut(1, { whatsappOptOut: true });

        expect(prismaMock.customer.update).toHaveBeenCalledWith({
          where: { id: 1 },
          data: { whatsappOptOut: true },
        });
        expect(result).toEqual(mockUpdated);
      });
    });
  });
});
