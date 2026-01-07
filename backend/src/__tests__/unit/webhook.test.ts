import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock dependencies BEFORE imports
jest.mock('../../utils/crypto');
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));
jest.mock('../../server', () => {
  const m = {
    emit: jest.fn(),
    to: jest.fn(),
  };
  m.to.mockReturnValue(m);
  return { io: m };
});
jest.mock('../../queues/workflowQueue', () => ({
  workflowQueue: {
    add: jest.fn().mockResolvedValue({}),
  },
}));

// Import prismaMock first to activate the jest.mock in prisma.mock.ts
import { prismaMock } from '../mocks/prisma.mock';
import { verifySignature } from '../../utils/crypto';
import { importOrdersViaWebhook } from '../../controllers/webhookController';

describe('Webhook Controller', () => {
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    mockReq = {
      headers: {},
      body: {},
      path: '/api/webhooks/import-orders',
      method: 'POST',
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe('importOrdersViaWebhook', () => {
    it('should import orders successfully with valid API key', async () => {
      const webhookData = {
        orders: [
          {
            id: 'ext-order-1',
            customer_phone: '+1234567890',
            customer_name: 'John Doe',
            amount: 100,
            address: '123 Main St',
            city: 'New York',
            state: 'NY',
            zip: '10001',
          },
        ],
      };

      mockReq.headers['x-api-key'] = 'valid-api-key';
      mockReq.body = webhookData;

      const mockWebhookConfig = {
        id: 'webhook-1',
        apiKey: 'valid-api-key',
        isActive: true,
        fieldMapping: {},
      };

      const mockCustomer = {
        id: 'customer-1',
        phoneNumber: '+1234567890',
        firstName: 'John',
        lastName: 'Doe',
      };

      prismaMock.webhookLog.create.mockResolvedValue({ id: 'log-1' } as any);
      prismaMock.webhookConfig.findFirst.mockResolvedValue(mockWebhookConfig as any);
      prismaMock.webhookLog.update.mockResolvedValue({} as any);
      prismaMock.customer.findUnique.mockResolvedValue(null);
      prismaMock.customer.create.mockResolvedValue(mockCustomer as any);
      prismaMock.order.count.mockResolvedValue(0);
      prismaMock.order.create.mockResolvedValue({} as any);

      await importOrdersViaWebhook(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Webhook processed',
          results: expect.objectContaining({
            success: 1,
            failed: 0,
          }),
        })
      );
    });

    it('should verify webhook signature when provided', async () => {
      const webhookData = { orders: [] };
      mockReq.headers['x-webhook-signature'] = 'invalid-signature';
      mockReq.headers['x-api-key'] = 'test-api-key';
      mockReq.body = webhookData;

      prismaMock.webhookLog.create.mockResolvedValue({ id: 'log-1' } as any);
      prismaMock.webhookConfig.findFirst.mockResolvedValue({
        id: 'webhook-1',
        apiKey: 'test-api-key',
        secret: 'test-secret',
        isActive: true,
      } as any);
      prismaMock.webhookLog.update.mockResolvedValue({} as any);

      await expect(importOrdersViaWebhook(mockReq, mockRes)).rejects.toThrow(
        'Invalid webhook signature'
      );
    });

    it('should reject invalid API key', async () => {
      mockReq.headers['x-api-key'] = 'invalid-key';
      mockReq.body = { orders: [] };

      prismaMock.webhookLog.create.mockResolvedValue({ id: 'log-1' } as any);
      prismaMock.webhookConfig.findFirst.mockResolvedValue(null);
      prismaMock.webhookLog.update.mockResolvedValue({} as any);

      await expect(importOrdersViaWebhook(mockReq, mockRes)).rejects.toThrow('Invalid API key');
    });

    it('should handle multiple orders in batch', async () => {
      const webhookData = {
        orders: [
          {
            id: 'ext-1',
            customer_phone: '+1111111111',
            customer_name: 'User 1',
            amount: 50,
          },
          {
            id: 'ext-2',
            customer_phone: '+2222222222',
            customer_name: 'User 2',
            amount: 75,
          },
        ],
      };

      mockReq.headers['x-api-key'] = 'valid-key';
      mockReq.body = webhookData;

      prismaMock.webhookLog.create.mockResolvedValue({ id: 'log-1' } as any);
      prismaMock.webhookConfig.findFirst.mockResolvedValue({
        id: 'webhook-1',
        isActive: true,
        fieldMapping: {},
      } as any);
      prismaMock.webhookLog.update.mockResolvedValue({} as any);
      prismaMock.customer.findUnique.mockResolvedValue(null);
      prismaMock.customer.create.mockResolvedValue({ id: 'customer' } as any);
      prismaMock.order.count.mockResolvedValue(0);
      prismaMock.order.create.mockResolvedValue({} as any);

      await importOrdersViaWebhook(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          results: expect.objectContaining({
            success: 2,
            failed: 0,
          }),
        })
      );
    });
  });
});
