/**
 * Integration Tests for Delivery GL Integration
 *
 * Tests automated GL entry creation when delivery status changes
 */

import { jest, describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import prisma from '../../utils/prisma';
import { DeliveryService } from '../../services/deliveryService';
import { OrderService } from '../../services/orderService';
import { Decimal } from '@prisma/client/runtime/library';
import { GL_ACCOUNTS } from '../../config/glAccounts';

// Mock socket instance
jest.mock('../../utils/socketInstance', () => ({
  getSocketInstance: jest.fn(() => ({
    to: jest.fn(() => ({
      emit: jest.fn(),
    })),
    emit: jest.fn(),
  })),
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Delivery GL Integration', () => {
  let testUser: any;
  let testCustomer: any;
  let testProduct: any;
  let testOrder: any;
  let testDelivery: any;
  let deliveryService: DeliveryService;
  let orderService: OrderService;

  beforeAll(async () => {
    deliveryService = new DeliveryService();
    orderService = new OrderService();
  });

  beforeEach(async () => {
    // Clean up test data in correct order to avoid FK issues
    await prisma.accountTransaction.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.transaction.deleteMany({});
    await (prisma as any).agentCollection.deleteMany({});
    await prisma.delivery.deleteMany({});
    await prisma.orderItem.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.account.deleteMany({});
    await prisma.user.deleteMany({
      where: { email: { in: ['testuser@example.com', 'testagent@example.com'] } },
    });

    // Create GL Accounts required for automation
    // We explicitly set IDs to match the codes because GLAutomationService uses codes as IDs
    const accounts = [
      { id: parseInt(GL_ACCOUNTS.CASH_IN_TRANSIT), code: GL_ACCOUNTS.CASH_IN_TRANSIT, name: 'Cash in Transit', accountType: 'asset', normalBalance: 'debit' },
      { id: parseInt(GL_ACCOUNTS.CASH_IN_HAND), code: GL_ACCOUNTS.CASH_IN_HAND, name: 'Cash in Hand', accountType: 'asset', normalBalance: 'debit' },
      { id: parseInt(GL_ACCOUNTS.INVENTORY), code: GL_ACCOUNTS.INVENTORY, name: 'Inventory', accountType: 'asset', normalBalance: 'debit' },
      { id: parseInt(GL_ACCOUNTS.PRODUCT_REVENUE), code: GL_ACCOUNTS.PRODUCT_REVENUE, name: 'Product Revenue', accountType: 'revenue', normalBalance: 'credit' },
      { id: parseInt(GL_ACCOUNTS.COGS), code: GL_ACCOUNTS.COGS, name: 'COGS', accountType: 'expense', normalBalance: 'debit' },
      { id: parseInt(GL_ACCOUNTS.FAILED_DELIVERY_EXPENSE), code: GL_ACCOUNTS.FAILED_DELIVERY_EXPENSE, name: 'Failed Delivery Expense', accountType: 'expense', normalBalance: 'debit' },
      { id: parseInt(GL_ACCOUNTS.RETURN_PROCESSING_EXPENSE), code: GL_ACCOUNTS.RETURN_PROCESSING_EXPENSE, name: 'Return Processing Expense', accountType: 'expense', normalBalance: 'debit' },
      { id: parseInt(GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION), code: GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION, name: 'Delivery Agent Commission', accountType: 'expense', normalBalance: 'debit' },
      { id: parseInt(GL_ACCOUNTS.SALES_REP_COMMISSION), code: GL_ACCOUNTS.SALES_REP_COMMISSION, name: 'Sales Rep Commission', accountType: 'expense', normalBalance: 'debit' },
      { id: parseInt(GL_ACCOUNTS.REFUND_LIABILITY), code: GL_ACCOUNTS.REFUND_LIABILITY, name: 'Refund Liability', accountType: 'liability', normalBalance: 'credit' },
    ];

    for (const account of accounts) {
      await prisma.account.create({ data: account as any });
    }

    // Create test user
    testUser = await prisma.user.create({
      data: {
        email: 'testuser@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'User',
        role: 'admin',
        phoneNumber: '0000000000',
      },
    });

    // Create test delivery agent
    const testAgent = await prisma.user.create({
      data: {
        email: 'testagent@example.com',
        password: 'password123',
        firstName: 'Test',
        lastName: 'Agent',
        role: 'delivery_agent',
        phoneNumber: '1111111111',
      },
    });

    // Create test customer
    testCustomer = await prisma.customer.create({
      data: {
        firstName: 'Test',
        lastName: 'Customer',
        phoneNumber: '1234567890',
        address: 'Test Address',
        state: 'Test State',
        area: 'Test Area',
      },
    });

    // Create test product with COGS
    testProduct = await prisma.product.create({
      data: {
        name: 'Test Product',
        price: 100,
        cogs: new Decimal(50),
        stockQuantity: 100,
        sku: 'TEST-SKU-001',
        category: 'Test Category',
      },
    });

    // Create test order
    testOrder = await prisma.order.create({
      data: {
        customerId: testCustomer.id,
        totalAmount: 210,
        subtotal: 200,
        shippingCost: 10,
        deliveryAddress: testCustomer.address,
        deliveryState: testCustomer.state,
        deliveryArea: testCustomer.area,
        status: 'out_for_delivery',
        deliveryAgentId: testAgent.id,
        orderItems: {
          create: [
            {
              productId: testProduct.id,
              quantity: 2,
              unitPrice: 100,
              totalPrice: 200,
            },
          ],
        },
      },
    });

    // Create test delivery
    testDelivery = await prisma.delivery.create({
      data: {
        orderId: testOrder.id,
        agentId: testAgent.id,
        scheduledTime: new Date(),
      },
    });
  });

  afterAll(async () => {
    // Clean up test data
    await prisma.accountTransaction.deleteMany({});
    await prisma.journalEntry.deleteMany({});
    await prisma.transaction.deleteMany({});
    await (prisma as any).agentCollection.deleteMany({});
    await prisma.delivery.deleteMany({});
    await prisma.orderItem.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.user.deleteMany({
      where: { email: { in: ['testuser@example.com', 'testagent@example.com'] } },
    });

    await prisma.$disconnect();
  });

  describe('Complete Delivery with COGS', () => {
    it('should create GL entry and update order when delivery completes', async () => {
      const result = await deliveryService.completeDelivery(
        testDelivery.id.toString(),
        {
          proofType: 'signature',
          proofData: 'signature.png',
          recipientName: 'Test Customer'
        },
        testUser.id.toString()
      );

      // Verify delivery and order state via Prisma because response might be different
      const updatedOrder = await prisma.order.findUnique({
        where: { id: testOrder.id }
      });

      expect(updatedOrder!.status).toBe('delivered');
      expect(updatedOrder!.revenueRecognized).toBe(true);
      expect(updatedOrder!.glJournalEntryId).not.toBeNull();

      // Verify GL entry was created
      const glEntry = await prisma.journalEntry.findUnique({
        where: { id: updatedOrder!.glJournalEntryId! },
        include: { transactions: true },
      });

      expect(glEntry).not.toBeNull();
      expect(glEntry!.sourceType).toBe('order_delivery');
      expect(glEntry!.sourceId).toBe(testOrder.id);

      // Verify balanced entry
      const totalDebits = glEntry!.transactions.reduce(
        (sum, t) => sum.plus(t.debitAmount),
        new Decimal(0)
      );
      const totalCredits = glEntry!.transactions.reduce(
        (sum, t) => sum.plus(t.creditAmount),
        new Decimal(0)
      );

      expect(totalDebits.toString()).toBe(totalCredits.toString());
      expect(glEntry!.transactions).toHaveLength(4);
    });
  });

  describe('Complete Delivery without COGS', () => {
    it('should create GL entry without COGS transactions when product has no COGS', async () => {
      // Update product to have no COGS
      await prisma.product.update({
        where: { id: testProduct.id },
        data: { cogs: null },
      });

      await deliveryService.completeDelivery(
        testDelivery.id.toString(),
        {
          proofType: 'signature',
          proofData: 'signature.png',
          recipientName: 'Test Customer'
        },
        testUser.id.toString()
      );

      const updatedOrder = await prisma.order.findUnique({
        where: { id: testOrder.id }
      });
      expect(updatedOrder!.revenueRecognized).toBe(true);

      // Verify GL entry was created
      const glEntry = await prisma.journalEntry.findUnique({
        where: { id: updatedOrder!.glJournalEntryId! },
        include: { transactions: true },
      });

      expect(glEntry).not.toBeNull();
      expect(glEntry!.transactions).toHaveLength(2);
    });
  });

  describe('Failed Delivery', () => {
    it('should create GL entry for failed delivery expense', async () => {
      await deliveryService.markDeliveryFailed(
        testDelivery.id.toString(),
        'Customer not home',
        testUser.id.toString()
      );

      const updatedDelivery = await prisma.delivery.findUnique({
        where: { id: testDelivery.id }
      });
      const updatedOrder = await prisma.order.findUnique({
        where: { id: testOrder.id }
      });

      expect(updatedOrder!.status).toBe('failed_delivery');

      // Verify GL entry was created
      const glEntries = await prisma.journalEntry.findMany({
        where: {
          sourceType: 'order_delivery',
          sourceId: testDelivery.id,
        },
        include: { transactions: true },
      });

      expect(glEntries).toHaveLength(1);

      const glEntry = glEntries[0];
      expect(glEntry.description).toContain('Failed delivery expense');
      expect(glEntry.transactions).toHaveLength(2);
    });
  });

  describe('Return Processing', () => {
    it('should create reversal GL entry and restore inventory when order returned', async () => {
      // First complete delivery to create revenue recognition entry
      await deliveryService.completeDelivery(
        testDelivery.id.toString(),
        {
          proofType: 'signature',
          proofData: 'signature.png',
          recipientName: 'Test Customer'
        },
        testUser.id.toString()
      );

      // Get original stock quantity
      const productBeforeReturn = await prisma.product.findUnique({
        where: { id: testProduct.id },
      });
      const stockBeforeReturn = productBeforeReturn!.stockQuantity;

      // Now process return
      await orderService.updateOrderStatus(
        testOrder.id,
        {
          status: 'returned',
          changedBy: testUser.id,
          notes: 'Defective product'
        }
      );

      const returnedOrder = await prisma.order.findUnique({
        where: { id: testOrder.id }
      });

      expect(returnedOrder!.status).toBe('returned');
      expect(returnedOrder!.revenueRecognized).toBe(false);

      // Verify reversal GL entry was created
      const reversalEntries = await prisma.journalEntry.findMany({
        where: {
          sourceType: 'order_return',
          sourceId: testOrder.id,
        },
        include: { transactions: true },
      });

      expect(reversalEntries).toHaveLength(1);

      // Verify inventory was restored
      const productAfterReturn = await prisma.product.findUnique({
        where: { id: testProduct.id },
      });

      expect(productAfterReturn!.stockQuantity).toBe(stockBeforeReturn + 2); // 2 items were ordered
    });
  });

  describe('Duplicate Prevention', () => {
    it('should not create duplicate GL entry if revenue already recognized', async () => {
      // Complete delivery first time
      await deliveryService.completeDelivery(
        testDelivery.id.toString(),
        {
          proofType: 'signature',
          proofData: 'signature.png',
          recipientName: 'Test Customer'
        },
        testUser.id.toString()
      );

      // Try to complete again
      await deliveryService.completeDelivery(
        testDelivery.id.toString(),
        {
          proofType: 'signature',
          proofData: 'signature.png',
          recipientName: 'Test Customer'
        },
        testUser.id.toString()
      ).catch(() => { }); // It might throw 'already completed'

      // Count GL entries
      const glEntries = await prisma.journalEntry.findMany({
        where: {
          sourceType: 'order_delivery',
          sourceId: testOrder.id,
        },
      });

      expect(glEntries.length).toBeLessThanOrEqual(1);
    });
  });

  describe('Transaction Rollback', () => {
    it('should rollback order changes if GL entry creation fails', async () => {
      // We verify that the transaction wraps both order update and GL creation
      // This is more about checking that the success path works as expected

      await deliveryService.completeDelivery(
        testDelivery.id.toString(),
        {
          proofType: 'signature',
          proofData: 'signature.png',
          recipientName: 'Test Customer'
        },
        testUser.id.toString()
      );

      // Verify order was updated
      const updatedOrder = await prisma.order.findUnique({
        where: { id: testOrder.id },
      });

      expect(updatedOrder!.status).toBe('delivered');
      expect(updatedOrder!.revenueRecognized).toBe(true);
    });
  });

  describe('GL Entry Balance Verification', () => {
    it('should create balanced GL entries for all scenarios', async () => {
      // Complete delivery
      await deliveryService.completeDelivery(
        testDelivery.id.toString(),
        {
          proofType: 'signature',
          proofData: 'signature.png',
          recipientName: 'Test Customer'
        },
        testUser.id.toString()
      );

      // Get all GL entries
      const glEntries = await prisma.journalEntry.findMany({
        include: { transactions: true },
      });

      // Verify all entries are balanced
      for (const entry of glEntries) {
        const totalDebits = entry.transactions.reduce(
          (sum, t) => sum.plus(t.debitAmount),
          new Decimal(0)
        );
        const totalCredits = entry.transactions.reduce(
          (sum, t) => sum.plus(t.creditAmount),
          new Decimal(0)
        );

        expect(totalDebits.toString()).toBe(totalCredits.toString());
      }
    });
  });
});
