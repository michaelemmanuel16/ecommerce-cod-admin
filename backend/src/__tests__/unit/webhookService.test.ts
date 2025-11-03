import { describe, it, expect, beforeEach } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { WebhookService } from '../../services/webhookService';
import { AppError } from '../../middleware/errorHandler';
import crypto from 'crypto';

describe('WebhookService', () => {
  let webhookService: WebhookService;

  beforeEach(() => {
    webhookService = new WebhookService();
  });

  describe('verifySignature', () => {
    it('should verify valid signature correctly', () => {
      const payload = JSON.stringify({ order: 'test' });
      const secret = 'test-secret';

      const hmac = crypto.createHmac('sha256', secret);
      const validSignature = hmac.update(payload).digest('hex');

      const result = webhookService.verifySignature(payload, validSignature, secret);

      expect(result).toBe(true);
    });

    it('should verify signature with sha256= prefix', () => {
      const payload = JSON.stringify({ order: 'test' });
      const secret = 'test-secret';

      const hmac = crypto.createHmac('sha256', secret);
      const digest = hmac.update(payload).digest('hex');
      const validSignature = `sha256=${digest}`;

      const result = webhookService.verifySignature(payload, validSignature, secret);

      expect(result).toBe(true);
    });

    it('should reject invalid signature', () => {
      const payload = JSON.stringify({ order: 'test' });
      const secret = 'test-secret';
      const invalidSignature = 'invalid-signature';

      const result = webhookService.verifySignature(payload, invalidSignature, secret);

      expect(result).toBe(false);
    });

    it('should handle verification errors gracefully', () => {
      const result = webhookService.verifySignature('', '', '');

      expect(result).toBe(false);
    });
  });

  describe('processWebhook', () => {
    const webhookConfig = {
      id: 'config-1',
      name: 'Test Webhook',
      url: 'https://example.com/webhook',
      secret: 'test-secret',
      apiKey: 'test-api-key',
      isActive: true,
      fieldMapping: {
        customerPhone: 'customer_phone',
        deliveryAddress: 'address',
        totalAmount: 'amount'
      }
    };

    const webhookData = {
      signature: 'valid-signature',
      apiKey: 'test-api-key',
      body: {
        customer_phone: '+1234567890',
        address: '123 Main St',
        amount: 100,
        city: 'New York',
        state: 'NY',
        zip: '10001',
        area: 'Manhattan'
      },
      headers: { 'content-type': 'application/json' },
      endpoint: '/api/webhooks/receive',
      method: 'POST'
    };

    it('should process webhook successfully with valid API key', async () => {
      prismaMock.webhookLog.create.mockResolvedValue({ id: 'log-1' } as any);
      prismaMock.webhookConfig.findFirst.mockResolvedValue(webhookConfig as any);
      prismaMock.webhookLog.update.mockResolvedValue({} as any);

      prismaMock.customer.findUnique.mockResolvedValue({
        id: 'customer-1',
        phoneNumber: '+1234567890'
      } as any);

      prismaMock.order.count.mockResolvedValue(0);
      prismaMock.order.create.mockResolvedValue({
        id: 'order-1',
        orderNumber: '1001'
      } as any);

      const result = await webhookService.processWebhook(webhookData);

      expect(result.message).toBe('Webhook processed');
      expect(result.results.success).toBe(1);
      expect(result.results.failed).toBe(0);
    });

    it('should throw error with invalid API key', async () => {
      prismaMock.webhookLog.create.mockResolvedValue({ id: 'log-1' } as any);
      prismaMock.webhookConfig.findFirst.mockResolvedValue(null);
      prismaMock.webhookLog.update.mockResolvedValue({} as any);

      await expect(
        webhookService.processWebhook(webhookData)
      ).rejects.toThrow(new AppError('Invalid API key', 401));
    });

    it('should create new customer if not exists', async () => {
      prismaMock.webhookLog.create.mockResolvedValue({ id: 'log-1' } as any);
      prismaMock.webhookConfig.findFirst.mockResolvedValue(webhookConfig as any);
      prismaMock.webhookLog.update.mockResolvedValue({} as any);

      prismaMock.customer.findUnique.mockResolvedValue(null);
      prismaMock.customer.create.mockResolvedValue({
        id: 'customer-new',
        phoneNumber: '+1234567890'
      } as any);

      prismaMock.order.count.mockResolvedValue(0);
      prismaMock.order.create.mockResolvedValue({
        id: 'order-1',
        orderNumber: '1001'
      } as any);

      const result = await webhookService.processWebhook(webhookData);

      expect(result.results.success).toBe(1);
      expect(prismaMock.customer.create).toHaveBeenCalled();
    });

    it('should handle multiple orders in webhook', async () => {
      const multiOrderData = {
        ...webhookData,
        body: {
          orders: [
            webhookData.body,
            { ...webhookData.body, customer_phone: '+9876543210' }
          ]
        }
      };

      prismaMock.webhookLog.create.mockResolvedValue({ id: 'log-1' } as any);
      prismaMock.webhookConfig.findFirst.mockResolvedValue(webhookConfig as any);
      prismaMock.webhookLog.update.mockResolvedValue({} as any);

      prismaMock.customer.findUnique.mockResolvedValue(null);
      prismaMock.customer.create.mockResolvedValue({
        id: 'customer-1',
        phoneNumber: '+1234567890'
      } as any);

      prismaMock.order.count.mockResolvedValue(0);
      prismaMock.order.create.mockResolvedValue({
        id: 'order-1',
        orderNumber: '1001'
      } as any);

      const result = await webhookService.processWebhook(multiOrderData);

      expect(result.results.success).toBe(2);
      expect(prismaMock.order.create).toHaveBeenCalledTimes(2);
    });

    it('should log failed orders and continue processing', async () => {
      prismaMock.webhookLog.create.mockResolvedValue({ id: 'log-1' } as any);
      prismaMock.webhookConfig.findFirst.mockResolvedValue(webhookConfig as any);
      prismaMock.webhookLog.update.mockResolvedValue({} as any);

      prismaMock.customer.findUnique.mockResolvedValue(null);
      prismaMock.customer.create.mockRejectedValue(new Error('Database error'));

      const result = await webhookService.processWebhook(webhookData);

      expect(result.results.failed).toBe(1);
      expect(result.results.errors).toHaveLength(1);
      expect(result.results.errors[0].error).toBe('Database error');
    });

    it('should update webhook log on error', async () => {
      prismaMock.webhookLog.create.mockResolvedValue({ id: 'log-1' } as any);
      prismaMock.webhookConfig.findFirst.mockResolvedValue(null);

      let logUpdate: any;
      prismaMock.webhookLog.update.mockImplementation((args: any) => {
        logUpdate = args.data;
        return Promise.resolve({} as any);
      });

      await expect(
        webhookService.processWebhook(webhookData)
      ).rejects.toThrow();

      expect(logUpdate.success).toBe(false);
      expect(logUpdate.statusCode).toBe(401);
      expect(logUpdate.errorMessage).toBe('Invalid API key');
    });
  });

  describe('createWebhook', () => {
    const createData = {
      name: 'Shopify Orders',
      url: 'https://example.com/webhook',
      secret: 'secret-key',
      apiKey: 'api-key',
      fieldMapping: {
        customerPhone: 'customer_phone',
        totalAmount: 'amount'
      },
      headers: {
        'Authorization': 'Bearer token'
      }
    };

    it('should create webhook configuration', async () => {
      const mockWebhook = {
        id: 'webhook-1',
        ...createData,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      prismaMock.webhookConfig.create.mockResolvedValue(mockWebhook as any);

      const webhook = await webhookService.createWebhook(createData);

      expect(webhook).toBeDefined();
      expect(webhook.name).toBe('Shopify Orders');
      expect(prismaMock.webhookConfig.create).toHaveBeenCalled();
    });
  });

  describe('testWebhook', () => {
    const webhookConfig = {
      id: 'webhook-1',
      fieldMapping: {
        customerPhone: 'customer_phone',
        deliveryAddress: 'address',
        totalAmount: 'amount'
      }
    };

    const sampleData = {
      customer_phone: '+1234567890',
      address: '123 Main St',
      amount: 100
    };

    it('should test field mapping successfully', async () => {
      prismaMock.webhookConfig.findUnique.mockResolvedValue(webhookConfig as any);

      const result = await webhookService.testWebhook('webhook-1', sampleData);

      expect(result.message).toBe('Webhook test successful');
      expect(result.mappedData.customerPhone).toBe('+1234567890');
      expect(result.mappedData.deliveryAddress).toBe('123 Main St');
      expect(result.mappedData.totalAmount).toBe(100);
      expect(result.sampleData).toEqual(sampleData);
    });

    it('should throw error when webhook not found', async () => {
      prismaMock.webhookConfig.findUnique.mockResolvedValue(null);

      await expect(
        webhookService.testWebhook('webhook-1', sampleData)
      ).rejects.toThrow(new AppError('Webhook not found', 404));
    });
  });

  describe('retryWebhook', () => {
    const webhookLog = {
      id: 'log-1',
      endpoint: '/api/webhooks/receive',
      method: 'POST',
      body: {
        customer_phone: '+1234567890',
        amount: 100
      },
      headers: {},
      success: false,
      webhookConfig: {
        apiKey: 'test-api-key'
      }
    };

    it('should retry failed webhook', async () => {
      prismaMock.webhookLog.findUnique.mockResolvedValue(webhookLog as any);
      prismaMock.webhookLog.create.mockResolvedValue({ id: 'log-2' } as any);
      prismaMock.webhookConfig.findFirst.mockResolvedValue({
        id: 'config-1',
        isActive: true,
        fieldMapping: {}
      } as any);
      prismaMock.webhookLog.update.mockResolvedValue({} as any);

      prismaMock.customer.findUnique.mockResolvedValue({
        id: 'customer-1'
      } as any);
      prismaMock.order.count.mockResolvedValue(0);
      prismaMock.order.create.mockResolvedValue({} as any);

      const result = await webhookService.retryWebhook('log-1');

      expect(result).toBeDefined();
    });

    it('should throw error when log not found', async () => {
      prismaMock.webhookLog.findUnique.mockResolvedValue(null);

      await expect(
        webhookService.retryWebhook('log-1')
      ).rejects.toThrow(new AppError('Webhook log not found', 404));
    });

    it('should throw error when retrying successful webhook', async () => {
      prismaMock.webhookLog.findUnique.mockResolvedValue({
        ...webhookLog,
        success: true
      } as any);

      await expect(
        webhookService.retryWebhook('log-1')
      ).rejects.toThrow(new AppError('Cannot retry successful webhook', 400));
    });
  });

  describe('getWebhookStats', () => {
    it('should calculate webhook statistics correctly', async () => {
      const mockLogs = [
        { processedAt: new Date(), success: true },
        { processedAt: new Date(), success: true },
        { processedAt: new Date(), success: false }
      ];

      prismaMock.webhookLog.count
        .mockResolvedValueOnce(3) // totalLogs
        .mockResolvedValueOnce(2) // successLogs
        .mockResolvedValueOnce(1); // failedLogs

      prismaMock.webhookLog.findMany.mockResolvedValue(mockLogs as any);

      const stats = await webhookService.getWebhookStats('webhook-1', { days: 30 });

      expect(stats.totalRequests).toBe(3);
      expect(stats.successfulRequests).toBe(2);
      expect(stats.failedRequests).toBe(1);
      expect(stats.successRate).toBe(66.66666666666666); // 2/3 * 100
      expect(stats.recentActivity).toHaveLength(3);
    });

    it('should handle webhooks with no requests', async () => {
      prismaMock.webhookLog.count.mockResolvedValue(0);
      prismaMock.webhookLog.findMany.mockResolvedValue([]);

      const stats = await webhookService.getWebhookStats('webhook-1');

      expect(stats.totalRequests).toBe(0);
      expect(stats.successfulRequests).toBe(0);
      expect(stats.failedRequests).toBe(0);
      expect(stats.successRate).toBe(0);
    });
  });

  describe('deleteWebhook', () => {
    it('should delete webhook configuration', async () => {
      const mockWebhook = {
        id: 'webhook-1',
        name: 'Test Webhook'
      };

      prismaMock.webhookConfig.findUnique.mockResolvedValue(mockWebhook as any);
      prismaMock.webhookConfig.delete.mockResolvedValue(mockWebhook as any);

      const result = await webhookService.deleteWebhook('webhook-1');

      expect(result.message).toBe('Webhook deleted successfully');
      expect(prismaMock.webhookConfig.delete).toHaveBeenCalled();
    });

    it('should throw error when webhook not found', async () => {
      prismaMock.webhookConfig.findUnique.mockResolvedValue(null);

      await expect(
        webhookService.deleteWebhook('webhook-1')
      ).rejects.toThrow(new AppError('Webhook not found', 404));
    });
  });

  describe('updateWebhook', () => {
    const mockWebhook = {
      id: 'webhook-1',
      name: 'Old Name'
    };

    it('should update webhook configuration', async () => {
      prismaMock.webhookConfig.findUnique.mockResolvedValue(mockWebhook as any);
      prismaMock.webhookConfig.update.mockResolvedValue({
        ...mockWebhook,
        name: 'New Name'
      } as any);

      const updated = await webhookService.updateWebhook('webhook-1', {
        name: 'New Name'
      });

      expect(updated.name).toBe('New Name');
      expect(prismaMock.webhookConfig.update).toHaveBeenCalled();
    });

    it('should throw error when webhook not found', async () => {
      prismaMock.webhookConfig.findUnique.mockResolvedValue(null);

      await expect(
        webhookService.updateWebhook('webhook-1', { name: 'New Name' })
      ).rejects.toThrow(new AppError('Webhook not found', 404));
    });
  });

  describe('getWebhookLogs', () => {
    it('should return paginated webhook logs', async () => {
      const mockLogs = [
        { id: 'log-1', endpoint: '/api/webhooks', success: true },
        { id: 'log-2', endpoint: '/api/webhooks', success: false }
      ];

      prismaMock.webhookLog.findMany.mockResolvedValue(mockLogs as any);
      prismaMock.webhookLog.count.mockResolvedValue(2);

      const result = await webhookService.getWebhookLogs('webhook-1', {
        page: 1,
        limit: 20
      });

      expect(result.logs).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.pages).toBe(1);
    });
  });
});
