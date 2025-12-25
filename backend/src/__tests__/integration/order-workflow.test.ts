import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';

/**
 * Integration Tests for Order Workflow
 *
 * These tests verify the complete order lifecycle:
 * 1. Create order
 * 2. Assign customer rep
 * 3. Confirm order
 * 4. Assign delivery agent
 * 5. Update to out for delivery
 * 6. Mark as delivered
 */

// Integration tests require a real test database with seeded data
// TODO: Set up test database and seed script before enabling these tests
describe.skip('Order Workflow Integration Tests', () => {
  let authToken: string;
  let orderId: string;
  let customerId: string;

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

  describe('Complete Order Lifecycle', () => {
    it('should create a new order', async () => {
      // First, create a customer
      const customerResponse = await request(app)
        .post('/api/customers')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          firstName: 'Test',
          lastName: 'Customer',
          phoneNumber: '+1234567890',
          email: 'test@customer.com',
          address: '123 Test St',
          city: 'New York',
          state: 'NY',
          zipCode: '10001',
        });

      expect(customerResponse.status).toBe(201);
      customerId = customerResponse.body.customer.id;

      // Create order
      const orderResponse = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerId,
          orderItems: [
            {
              productId: 'test-product-id',
              quantity: 2,
              unitPrice: 50,
            },
          ],
          subtotal: 100,
          shippingCost: 10,
          totalAmount: 110,
          deliveryAddress: '123 Test St',
          deliveryCity: 'New York',
          deliveryState: 'NY',
          deliveryZipCode: '10001',
          deliveryArea: 'Manhattan',
          notes: 'Test order for integration testing',
        });

      expect(orderResponse.status).toBe(201);
      expect(orderResponse.body.order).toHaveProperty('id');
      expect(orderResponse.body.order).toHaveProperty('orderNumber');
      expect(orderResponse.body.order.status).toBe('pending_confirmation');

      orderId = orderResponse.body.order.id;
    });

    it('should update order status to confirmed', async () => {
      const response = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          status: 'confirmed',
          notes: 'Order confirmed by customer rep',
        });

      expect(response.status).toBe(200);
      expect(response.body.order.status).toBe('confirmed');
    });

    it('should assign customer rep to order', async () => {
      const response = await request(app)
        .patch(`/api/orders/${orderId}/assign-rep`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          customerRepId: 'test-rep-id',
        });

      expect(response.status).toBe(200);
      expect(response.body.order.customerRepId).toBe('test-rep-id');
    });

    it('should assign delivery agent to order', async () => {
      const response = await request(app)
        .patch(`/api/orders/${orderId}/assign-agent`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          deliveryAgentId: 'test-agent-id',
        });

      expect(response.status).toBe(200);
      expect(response.body.order.deliveryAgentId).toBe('test-agent-id');
    });

    it('should fetch order history', async () => {
      const response = await request(app)
        .get(`/api/orders/${orderId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.order.orderHistory).toBeInstanceOf(Array);
      expect(response.body.order.orderHistory.length).toBeGreaterThan(0);
    });

    it('should get kanban view with orders grouped by status', async () => {
      const response = await request(app)
        .get('/api/orders/kanban')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.kanban).toHaveProperty('pending_confirmation');
      expect(response.body.kanban).toHaveProperty('confirmed');
      expect(response.body.kanban).toHaveProperty('delivered');
    });
  });
});
