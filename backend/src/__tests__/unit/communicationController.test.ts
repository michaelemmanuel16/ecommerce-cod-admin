import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { Response } from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../../types';
import * as communicationController from '../../controllers/communicationController';
import { communicationService } from '../../services/communicationService';

// Mock communicationService
jest.mock('../../services/communicationService', () => ({
  __esModule: true,
  communicationService: {
    getMessages: jest.fn(),
    getStats: jest.fn(),
    getRecipients: jest.fn(),
    bulkSendSms: jest.fn(),
    bulkSendWhatsApp: jest.fn(),
    getTemplates: jest.fn(),
    createTemplate: jest.fn(),
    updateTemplate: jest.fn(),
    deleteTemplate: jest.fn(),
    getOptOutCustomers: jest.fn(),
    updateCustomerOptOut: jest.fn(),
  },
}));

describe('Communication Controller', () => {
  let mockReq: Partial<AuthRequest>;
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockReq = {
      query: {},
      body: {},
      params: {},
      user: { id: 1, role: 'admin', email: 'admin@test.com' } as any,
    };
    mockRes = {
      json: jest.fn().mockReturnThis() as any,
      status: jest.fn().mockReturnThis() as any,
    };
    jest.clearAllMocks();
  });

  describe('getMessages', () => {
    it('should return messages with pagination', async () => {
      const mockResult = { data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } };
      (communicationService.getMessages as jest.Mock).mockResolvedValue(mockResult);

      await communicationController.getMessages(mockReq as AuthRequest, mockRes as Response);

      expect(communicationService.getMessages).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });

    it('should pass query params to service', async () => {
      mockReq.query = { page: '2', limit: '10', channel: 'sms', status: 'sent' };
      (communicationService.getMessages as jest.Mock).mockResolvedValue({ data: [], pagination: {} });

      await communicationController.getMessages(mockReq as AuthRequest, mockRes as Response);

      expect(communicationService.getMessages).toHaveBeenCalledWith({
        page: 2,
        limit: 10,
        channel: 'sms',
        status: 'sent',
        startDate: undefined,
        endDate: undefined,
      });
    });

    it('should return 500 on service error', async () => {
      (communicationService.getMessages as jest.Mock).mockRejectedValue(new Error('DB error'));

      await communicationController.getMessages(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'DB error' });
    });
  });

  describe('getStats', () => {
    it('should return stats', async () => {
      const mockStats = { total: 100, byStatus: {}, byChannel: {} };
      (communicationService.getStats as jest.Mock).mockResolvedValue(mockStats);

      await communicationController.getStats(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(mockStats);
    });

    it('should pass date range params', async () => {
      mockReq.query = { startDate: '2026-01-01', endDate: '2026-01-31' };
      (communicationService.getStats as jest.Mock).mockResolvedValue({ total: 0 });

      await communicationController.getStats(mockReq as AuthRequest, mockRes as Response);

      expect(communicationService.getStats).toHaveBeenCalledWith('2026-01-01', '2026-01-31');
    });
  });

  describe('getRecipients', () => {
    it('should return 400 when channel is missing', async () => {
      mockReq.query = {};

      await communicationController.getRecipients(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'channel query param is required (sms or whatsapp)' });
    });

    it('should return 400 when channel is invalid', async () => {
      mockReq.query = { channel: 'email' };

      await communicationController.getRecipients(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should return recipients for valid sms channel', async () => {
      mockReq.query = { channel: 'sms' };
      const mockRecipients = [{ id: 1, firstName: 'John' }];
      (communicationService.getRecipients as jest.Mock).mockResolvedValue(mockRecipients);

      await communicationController.getRecipients(mockReq as AuthRequest, mockRes as Response);

      expect(communicationService.getRecipients).toHaveBeenCalledWith({
        state: undefined,
        productId: undefined,
        hasOrdered: false,
        channel: 'sms',
      });
      expect(mockRes.json).toHaveBeenCalledWith(mockRecipients);
    });

    it('should parse productId as number', async () => {
      mockReq.query = { channel: 'whatsapp', productId: '5' };
      (communicationService.getRecipients as jest.Mock).mockResolvedValue([]);

      await communicationController.getRecipients(mockReq as AuthRequest, mockRes as Response);

      expect(communicationService.getRecipients).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 5, channel: 'whatsapp' }),
      );
    });
  });

  describe('bulkSendSms', () => {
    it('should return 400 when customerIds is not an array', async () => {
      mockReq.body = { customerIds: 'not-an-array', message: 'Hello' };

      await communicationController.bulkSendSms(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      // Zod validation produces structured error messages
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it('should return 400 when message is missing', async () => {
      mockReq.body = { customerIds: [1, 2] };

      await communicationController.bulkSendSms(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should forward valid request to service', async () => {
      mockReq.body = { customerIds: [1, 2], message: 'Hello!' };
      const mockResult = { total: 2, results: [{ customerId: 1, success: true }] };
      (communicationService.bulkSendSms as jest.Mock).mockResolvedValue(mockResult);

      await communicationController.bulkSendSms(mockReq as AuthRequest, mockRes as Response);

      expect(communicationService.bulkSendSms).toHaveBeenCalledWith([1, 2], 'Hello!');
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });
  });

  describe('bulkSendWhatsApp', () => {
    it('should return 400 when customerIds is not an array', async () => {
      mockReq.body = { customerIds: 'invalid', templateKey: 'confirmed' };

      await communicationController.bulkSendWhatsApp(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it('should return 400 when templateKey is missing', async () => {
      mockReq.body = { customerIds: [1] };

      await communicationController.bulkSendWhatsApp(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should forward valid request to service with optional customLink', async () => {
      mockReq.body = { customerIds: [1], templateKey: 'confirmed', customLink: 'https://example.com' };
      const mockResult = { total: 1, results: [] };
      (communicationService.bulkSendWhatsApp as jest.Mock).mockResolvedValue(mockResult);

      await communicationController.bulkSendWhatsApp(mockReq as AuthRequest, mockRes as Response);

      expect(communicationService.bulkSendWhatsApp).toHaveBeenCalledWith([1], 'confirmed', 'https://example.com');
      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });
  });

  describe('getTemplates', () => {
    it('should return templates', async () => {
      const mockTemplates = [{ id: 1, name: 'Welcome', body: 'Hi!' }];
      (communicationService.getTemplates as jest.Mock).mockResolvedValue(mockTemplates);

      await communicationController.getTemplates(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(mockTemplates);
    });
  });

  describe('createTemplate', () => {
    it('should return 400 when name is missing', async () => {
      mockReq.body = { body: 'Hello' };

      await communicationController.createTemplate(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it('should return 400 when body is missing', async () => {
      mockReq.body = { name: 'Template' };

      await communicationController.createTemplate(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should create template and return 201', async () => {
      mockReq.body = { name: 'Welcome', body: 'Hi {{name}}!' };
      const mockTemplate = { id: 1, name: 'Welcome', body: 'Hi {{name}}!' };
      (communicationService.createTemplate as jest.Mock).mockResolvedValue(mockTemplate);

      await communicationController.createTemplate(mockReq as AuthRequest, mockRes as Response);

      expect(communicationService.createTemplate).toHaveBeenCalledWith({ name: 'Welcome', body: 'Hi {{name}}!' } as any);
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(mockTemplate);
    });
  });

  describe('updateTemplate', () => {
    it('should update template by id with valid body', async () => {
      mockReq.params = { id: '5' };
      mockReq.body = { name: 'Updated', body: 'Updated body text' };
      const mockUpdated = { id: 5, name: 'Updated', body: 'Updated body text' };
      (communicationService.updateTemplate as jest.Mock).mockResolvedValue(mockUpdated);

      await communicationController.updateTemplate(mockReq as AuthRequest, mockRes as Response);

      expect(communicationService.updateTemplate).toHaveBeenCalledWith(5, { name: 'Updated', body: 'Updated body text' });
      expect(mockRes.json).toHaveBeenCalledWith(mockUpdated);
    });

    it('should return 400 when Zod validation fails (missing required fields)', async () => {
      mockReq.params = { id: '5' };
      mockReq.body = { name: 'Updated' }; // missing 'body' field required by templateSchema

      await communicationController.updateTemplate(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });

    it('should return 500 when service throws a generic error', async () => {
      mockReq.params = { id: '999' };
      mockReq.body = { name: 'Updated', body: 'Some body' };
      (communicationService.updateTemplate as jest.Mock).mockRejectedValue(new Error('Database error'));

      await communicationController.updateTemplate(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Database error' });
    });
  });

  describe('deleteTemplate', () => {
    it('should delete template and return success', async () => {
      mockReq.params = { id: '3' };
      (communicationService.deleteTemplate as jest.Mock).mockResolvedValue({ id: 3 });

      await communicationController.deleteTemplate(mockReq as AuthRequest, mockRes as Response);

      expect(communicationService.deleteTemplate).toHaveBeenCalledWith(3);
      expect(mockRes.json).toHaveBeenCalledWith({ success: true });
    });

    it('should return 500 when delete fails with generic error', async () => {
      mockReq.params = { id: '999' };
      (communicationService.deleteTemplate as jest.Mock).mockRejectedValue(new Error('Database error'));

      await communicationController.deleteTemplate(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Database error' });
    });

    it('should return 404 when Prisma P2025 error (record not found)', async () => {
      mockReq.params = { id: '999' };
      const prismaError = new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '5.0.0',
      });
      (communicationService.deleteTemplate as jest.Mock).mockRejectedValue(prismaError);

      await communicationController.deleteTemplate(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Template not found' });
    });
  });

  describe('getOptOutCustomers', () => {
    it('should return opt-out customers with pagination', async () => {
      const mockResult = {
        customers: [{ id: 1, firstName: 'John', smsOptOut: true }],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      };
      (communicationService.getOptOutCustomers as jest.Mock).mockResolvedValue(mockResult);

      await communicationController.getOptOutCustomers(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(mockResult);
    });

    it('should parse page and limit from query', async () => {
      mockReq.query = { page: '2', limit: '10' };
      (communicationService.getOptOutCustomers as jest.Mock).mockResolvedValue({ customers: [], pagination: {} });

      await communicationController.getOptOutCustomers(mockReq as AuthRequest, mockRes as Response);

      expect(communicationService.getOptOutCustomers).toHaveBeenCalledWith(2, 10);
    });
  });

  describe('updateOptOut', () => {
    it('should update opt-out status for customer', async () => {
      mockReq.params = { customerId: '5' };
      mockReq.body = { smsOptOut: true, whatsappOptOut: false };
      const mockCustomer = { id: 5, smsOptOut: true, whatsappOptOut: false };
      (communicationService.updateCustomerOptOut as jest.Mock).mockResolvedValue(mockCustomer);

      await communicationController.updateOptOut(mockReq as AuthRequest, mockRes as Response);

      expect(communicationService.updateCustomerOptOut).toHaveBeenCalledWith(5, {
        smsOptOut: true,
        whatsappOptOut: false,
      });
      expect(mockRes.json).toHaveBeenCalledWith(mockCustomer);
    });

    it('should return 500 when customer not found', async () => {
      mockReq.params = { customerId: '999' };
      mockReq.body = { smsOptOut: true };
      (communicationService.updateCustomerOptOut as jest.Mock).mockRejectedValue(new Error('Record not found'));

      await communicationController.updateOptOut(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should return 400 when neither smsOptOut nor whatsappOptOut is provided', async () => {
      mockReq.params = { customerId: '5' };
      mockReq.body = {};

      await communicationController.updateOptOut(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
    });
  });
});
