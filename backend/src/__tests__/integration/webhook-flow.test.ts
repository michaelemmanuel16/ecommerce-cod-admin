import { describe, it, expect, beforeAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { generateSignature } from '../../utils/crypto';

/**
 * Integration Tests for Webhook Flow
 *
 * These tests verify:
 * 1. Webhook configuration creation
 * 2. Order import via webhook
 * 3. Signature verification
 * 4. Field mapping
 * 5. Webhook logging
 */

// Integration tests require a real test database with seeded data
// TODO: Set up test database and seed script before enabling these tests
describe.skip('Webhook Flow Integration Tests', () => {
  let authToken: string;
  let webhookId: string;
  let apiKey: string;

  beforeAll(async () => {
    // Login to get auth token
    const response = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'admin@example.com',
        password: 'admin123',
      });

    authToken = response.body.accessToken;
  });

  describe('Webhook Configuration and Import', () => {
    it('should create webhook configuration', async () => {
      const response = await request(app)
        .post('/api/webhooks')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Shopify Integration',
          url: 'https://example.com/webhook',
          secret: 'test-secret-key',
          apiKey: 'test-api-key-123',
          fieldMapping: {
            customerPhone: 'customer.phone',
            customerFirstName: 'customer.first_name',
            customerLastName: 'customer.last_name',
            deliveryAddress: 'shipping_address.address1',
            deliveryCity: 'shipping_address.city',
            deliveryState: 'shipping_address.province',
            deliveryZipCode: 'shipping_address.zip',
            subtotal: 'subtotal_price',
            totalAmount: 'total_price',
          },
        });

      expect(response.status).toBe(201);
      expect(response.body.webhook).toHaveProperty('id');
      webhookId = response.body.webhook.id;
      apiKey = response.body.webhook.apiKey;
    });

    it('should import orders via webhook with valid API key', async () => {
      const webhookPayload = {
        orders: [
          {
            id: 'shopify-order-123',
            order_id: '123456',
            customer_phone: '+1234567890',
            customer_name: 'John Doe',
            amount: 150.00,
            address: '456 Webhook St',
            city: 'Los Angeles',
            state: 'CA',
            zip: '90001',
            area: 'Downtown',
            notes: 'Please deliver before 5 PM',
          },
        ],
      };

      const response = await request(app)
        .post('/api/webhooks/import-orders')
        .set('x-api-key', apiKey)
        .send(webhookPayload);

      expect(response.status).toBe(200);
      expect(response.body.results.success).toBe(1);
      expect(response.body.results.failed).toBe(0);
    });

    it('should reject webhook with invalid API key', async () => {
      const response = await request(app)
        .post('/api/webhooks/import-orders')
        .set('x-api-key', 'invalid-api-key')
        .send({ orders: [] });

      expect(response.status).toBe(401);
    });

    it('should verify webhook signature', async () => {
      const payload = JSON.stringify({ test: 'data' });
      const signature = generateSignature(payload);

      const response = await request(app)
        .post('/api/webhooks/import-orders')
        .set('x-webhook-signature', signature)
        .set('x-api-key', apiKey)
        .send({ test: 'data' });

      // Should process without signature error
      expect(response.status).not.toBe(401);
    });

    it('should retrieve webhook logs', async () => {
      const response = await request(app)
        .get(`/api/webhooks/${webhookId}/logs`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.logs).toBeInstanceOf(Array);
      expect(response.body.pagination).toHaveProperty('total');
    });

    it('should test webhook field mapping', async () => {
      const sampleData = {
        customer: {
          phone: '+9876543210',
          first_name: 'Jane',
          last_name: 'Smith',
        },
        shipping_address: {
          address1: '789 Test Ave',
          city: 'Chicago',
          province: 'IL',
          zip: '60601',
        },
        subtotal_price: '200.00',
        total_price: '220.00',
      };

      const response = await request(app)
        .post(`/api/webhooks/${webhookId}/test`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ sampleData });

      expect(response.status).toBe(200);
      expect(response.body.mappedData).toHaveProperty('customerPhone');
      expect(response.body.mappedData).toHaveProperty('totalAmount');
    });
  });
});
