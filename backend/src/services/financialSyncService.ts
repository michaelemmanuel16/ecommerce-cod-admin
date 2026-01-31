/**
 * Financial Sync Service
 *
 * Automatically creates financial records when orders are delivered:
 * - Transaction records (for COD tracking)
 * - General Ledger entries (via GLAutomationService)
 *
 * This ensures imported and manually created orders are properly recognized
 * by the Financial Management module.
 */

import { Prisma, Order, OrderItem, Product, Customer, User } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { GLAutomationService, OrderWithItems } from './glAutomationService';
import logger from '../utils/logger';
import { SYSTEM_USER_ID } from '../config/constants';

interface OrderForSync extends Order {
  orderItems: (OrderItem & { product: Product })[];
  customer: Customer;
  deliveryAgent: User | null;
  customerRep: User | null;
}

export class FinancialSyncService {
  /**
   * Sync financial data for a delivered order
   * Creates Transaction record and GL entries
   *
   * @param tx - Prisma transaction client
   * @param order - Order with items, customer, agents
   * @param userId - User ID creating the entries (defaults to SYSTEM_USER_ID)
   * @returns Object with transaction and journal entry created
   */
  static async syncOrderFinancialData(
    tx: Prisma.TransactionClient,
    order: OrderForSync,
    userId: number = SYSTEM_USER_ID
  ): Promise<{
    transaction: any;
    journalEntry: any;
  }> {
    // Validation
    if (order.status !== 'delivered') {
      logger.warn(`Cannot sync financial data for order ${order.id} - status is ${order.status}, not delivered`);
      return { transaction: null, journalEntry: null };
    }

    if (!order.codAmount) {
      logger.info(`Skipping financial sync for order ${order.id} - not a COD order`);
      return { transaction: null, journalEntry: null };
    }

    // Check if already synced
    const existingTransaction = await tx.transaction.findFirst({
      where: {
        orderId: order.id,
        type: 'cod_collection'
      }
    });

    if (existingTransaction) {
      logger.info(`Order ${order.id} already has Transaction record (ID: ${existingTransaction.id})`);
      return { transaction: existingTransaction, journalEntry: null };
    }

    // Check if revenue already recognized
    if ((order as any).revenueRecognized) {
      logger.info(`Order ${order.id} already has revenue recognized`);
      return { transaction: null, journalEntry: null };
    }

    try {
      // Step 1: Create Transaction record for COD tracking
      const transaction = await tx.transaction.create({
        data: {
          orderId: order.id,
          type: 'cod_collection',
          status: 'collected', // Delivered = collected
          amount: order.totalAmount,
          paymentMethod: 'cod',
          reference: `COD-${order.id}`,
          metadata: {
            autoSync: true,
            syncedAt: new Date().toISOString(),
            orderDeliveryDate: order.deliveryDate?.toISOString() || order.updatedAt.toISOString()
          }
        }
      });

      logger.info(`Created Transaction record for order ${order.id} (Transaction ID: ${transaction.id})`);

      // Step 2: Calculate COGS
      let totalCOGS = new Decimal(0);
      for (const item of order.orderItems) {
        const cogs = item.product.cogs ? new Decimal(item.product.cogs.toString()) : new Decimal(0);
        totalCOGS = totalCOGS.plus(cogs.times(item.quantity));
      }

      // Step 3: Create GL entries using GLAutomationService
      const journalEntry = await GLAutomationService.createRevenueRecognitionEntry(
        tx,
        order as OrderWithItems,
        totalCOGS,
        userId
      );

      logger.info(`Created GL journal entry for order ${order.id} (Entry: ${journalEntry.entryNumber})`);

      // Step 4: Mark order as revenue recognized
      await tx.order.update({
        where: { id: order.id },
        data: { revenueRecognized: true }
      });

      return {
        transaction,
        journalEntry
      };
    } catch (error: any) {
      logger.error(`Error syncing financial data for order ${order.id}:`, error);
      throw error;
    }
  }

  /**
   * Sync financial data for multiple orders in batch
   * Useful for backfilling imported orders
   *
   * @param orderIds - Array of order IDs to sync
   * @param userId - User ID creating the entries
   * @returns Summary of sync results
   */
  static async batchSyncOrders(
    orderIds: number[],
    userId: number = SYSTEM_USER_ID
  ): Promise<{
    synced: number;
    skipped: number;
    errors: Array<{ orderId: number; error: string }>;
  }> {
    const results = {
      synced: 0,
      skipped: 0,
      errors: [] as Array<{ orderId: number; error: string }>
    };

    for (const orderId of orderIds) {
      try {
        await this.syncSingleOrder(orderId, userId);
        results.synced++;
      } catch (error: any) {
        logger.error(`Error syncing order ${orderId}:`, error);
        results.errors.push({
          orderId,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Sync a single order by ID (wraps in transaction)
   *
   * @param orderId - Order ID to sync
   * @param userId - User ID creating the entries
   */
  private static async syncSingleOrder(
    orderId: number,
    userId: number = SYSTEM_USER_ID
  ): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: orderId, deletedAt: null },
      include: {
        orderItems: {
          include: { product: true }
        },
        customer: true,
        deliveryAgent: true,
        customerRep: true
      }
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (order.status !== 'delivered') {
      logger.info(`Skipping order ${orderId} - not delivered (status: ${order.status})`);
      return;
    }

    await prisma.$transaction(async (tx) => {
      await this.syncOrderFinancialData(tx as any, order as OrderForSync, userId);
    });
  }

  /**
   * Check if order needs financial sync
   *
   * @param orderId - Order ID to check
   * @returns true if order needs sync, false otherwise
   */
  static async needsSync(orderId: number): Promise<boolean> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        status: true,
        codAmount: true,
        revenueRecognized: true
      }
    });

    if (!order || order.status !== 'delivered' || !order.codAmount) {
      return false;
    }

    if ((order as any).revenueRecognized) {
      return false;
    }

    const hasTransaction = await prisma.transaction.findFirst({
      where: {
        orderId,
        type: 'cod_collection'
      }
    });

    return !hasTransaction;
  }
}

// Export singleton instance
import prisma from '../utils/prisma';
export default FinancialSyncService;
