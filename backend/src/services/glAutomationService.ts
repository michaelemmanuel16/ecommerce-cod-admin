/**
 * GL Automation Service
 *
 * Handles automated creation of General Ledger (GL) journal entries for order lifecycle events:
 * - Revenue recognition when orders are delivered
 * - Failed delivery expense recording
 * - Return reversal and expense recording
 * - Inventory restoration on returns
 *
 * All methods are designed to be called from within Prisma transactions to ensure atomicity.
 */

import { Prisma, Order, OrderItem, Product, Delivery } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { GL_ACCOUNTS, GL_DEFAULTS } from '../config/glAccounts';
import logger from '../utils/logger';
import prisma from '../utils/prisma';
// import { SYSTEM_USER_ID } from '../config/constants'; // Commented out unused variable to resolve lint error

// Define JournalSourceType locally if not correctly imported or use string literal
// type JournalSourceType = 'order_delivery' | 'failed_delivery' | 'order_return' | 'manual' | 'agent_collection'; // Commented out unused type to resolve lint error

// Type for order items with product information
type OrderItemWithProduct = OrderItem & { product: Product };

// Type for orders with items and products
type OrderWithItems = any; // Flexible type for now to avoid include issues

/**
 * GL Automation Service
 * Static methods for creating automated GL entries
 */
export class GLAutomationService {
  /**
   * Generate unique journal entry number
   * Format: JE-YYYYMMDD-XXXXX (e.g., JE-20260117-00001)
   * Sequence resets daily
   */
  private static async generateEntryNumber(tx: Prisma.TransactionClient): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');

    // Find the last entry for today
    const result = await tx.$queryRaw<any[]>`
      SELECT entry_number
      FROM journal_entries
      WHERE entry_number LIKE ${'JE-' + dateStr + '-%'}
      ORDER BY entry_number DESC
      LIMIT 1
      FOR UPDATE
    `;

    let sequence = 1;
    if (result.length > 0) {
      const lastNumber = result[0].entry_number;
      // Handle the case where the entry_number format might be unexpected
      try {
        const lastSequence = parseInt(lastNumber.split('-')[2], 10);
        if (!isNaN(lastSequence)) {
          sequence = lastSequence + 1;
        }
      } catch (e) {
        logger.warn('Failed to parse last journal entry sequence, starting from 1');
      }
    }

    return `JE-${dateStr}-${sequence.toString().padStart(5, '0')}`;
  }

  /**
   * Create journal entry with retry logic for handling race conditions
   *
   * @param tx - Prisma transaction client
   * @param data - Journal entry data (without entryNumber)
   * @returns Created journal entry with transactions included
   */
  private static async createJournalEntryWithRetry(
    tx: Prisma.TransactionClient,
    data: any
  ): Promise<any> {
    const maxRetries = 5;
    let retries = 0;
    let lastError: any;

    while (retries < maxRetries) {
      try {
        const entryNumber = await this.generateEntryNumber(tx);
        return await tx.journalEntry.create({
          data: {
            ...data,
            entryNumber,
          },
          include: {
            transactions: {
              include: {
                account: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                  },
                },
              },
            },
          },
        });
      } catch (error: any) {
        lastError = error;
        // P2002 is Prisma's code for unique constraint violation
        if (error.code === 'P2002' && (error.meta?.target?.includes('entry_number') || error.message?.includes('entry_number'))) {
          retries++;
          logger.warn(`Unique constraint violation on journal entry_number, retrying (${retries}/${maxRetries})...`);
          // Small random delay before retry to reduce contention
          await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 50) + 10));
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error(`Failed to create unique journal entry after ${maxRetries} retries`);
  }

  /**
   * Calculate total Cost of Goods Sold (COGS) from order items
   *
   * @param orderItems - Array of order items with product information
   * @returns Total COGS as Decimal
   */
  static calculateTotalCOGS(orderItems: OrderItemWithProduct[]): Decimal {
    let totalCOGS = new Decimal(0);

    for (const item of orderItems) {
      const productCOGS = new Decimal(item.product.cogs || 0);
      const itemCOGS = productCOGS.times(item.quantity);
      totalCOGS = totalCOGS.plus(itemCOGS);
    }

    return totalCOGS;
  }

  /**
   * Validate that all products have COGS set
   *
   * @param orderItems - Array of order items with product information
   * @returns Validation result with list of products missing COGS
   */
  static validateCOGS(orderItems: OrderItemWithProduct[]): {
    valid: boolean;
    missingProducts: string[];
  } {
    const missingProducts: string[] = [];

    for (const item of orderItems) {
      const cogs = new Decimal(item.product.cogs || 0);
      if (cogs.equals(0)) {
        missingProducts.push(item.product.name);
      }
    }

    return {
      valid: missingProducts.length === 0,
      missingProducts,
    };
  }

  /**
   * Create revenue recognition GL entry when order is delivered
   *
   * Creates journal entry with:
   * - Debit: Cash in Transit (order amount - delivery commission - sales rep commission)
   * - Debit: Delivery Agent Commission Expense (if agent assigned)
   * - Debit: Sales Rep Commission Expense (if rep assigned)
   * - Credit: Product Revenue (full order amount)
   * - Debit: COGS (if totalCOGS > threshold)
   * - Credit: Inventory (if totalCOGS > threshold)
   *
   * @param tx - Prisma transaction client
   * @param order - Order with items and products
   * @param totalCOGS - Total cost of goods sold
   * @param userId - ID of user creating the entry
   * @returns Created journal entry
   */
  static async createRevenueRecognitionEntry(
    tx: Prisma.TransactionClient,
    order: OrderWithItems,
    totalCOGS: Decimal,
    userId: number
  ): Promise<any> {
    const orderData = order as any;
    const orderAmount = new Decimal(orderData.totalAmount);

    // Fetch delivery agent's commission (stored in commissionAmount as fixed amount)
    const deliveryAgent = order.deliveryAgentId
      ? await tx.user.findUnique({
        where: { id: order.deliveryAgentId },
        select: { id: true, commissionAmount: true } as any,
      })
      : null;

    // Fetch sales rep's commission (stored in commissionAmount as fixed amount)
    const salesRep = order.customerRepId
      ? await tx.user.findUnique({
        where: { id: order.customerRepId },
        select: { id: true, commissionAmount: true } as any,
      })
      : null;

    // Commission amounts (stored in commissionAmount field as fixed amounts)
    const deliveryCommission = deliveryAgent
      ? (new Decimal((deliveryAgent as any).commissionAmount || 0))
      : new Decimal(0);

    const salesRepCommission = salesRep
      ? (new Decimal((salesRep as any).commissionAmount || 0))
      : new Decimal(0);

    // Calculate net cash company receives (order total - both commissions)
    const totalCommissions = deliveryCommission.plus(salesRepCommission);
    const cashInTransit = orderAmount.minus(totalCommissions);

    // Build journal entry transactions
    const transactions: any[] = [
      {
        accountId: parseInt(GL_ACCOUNTS.CASH_IN_TRANSIT),
        debitAmount: cashInTransit.toString(),
        creditAmount: '0',
        description: `Cash from delivered order ${order.id} (net of commissions)`,
      },
      {
        accountId: parseInt(GL_ACCOUNTS.PRODUCT_REVENUE),
        debitAmount: '0',
        creditAmount: orderAmount.toString(),
        description: 'Product sales revenue',
      },
    ];

    // Add delivery agent commission expense if applicable
    if (deliveryCommission.greaterThan(0)) {
      transactions.push({
        accountId: parseInt(GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION),
        debitAmount: deliveryCommission.toString(),
        creditAmount: '0',
        description: 'Delivery agent commission expense',
      });
    }

    // Add sales rep commission expense if applicable
    if (salesRepCommission.greaterThan(0)) {
      transactions.push({
        accountId: parseInt(GL_ACCOUNTS.SALES_REP_COMMISSION),
        debitAmount: salesRepCommission.toString(),
        creditAmount: '0',
        description: 'Sales representative commission expense',
      });
    }

    // Add COGS and inventory lines if COGS exceeds threshold
    if (totalCOGS.greaterThan(new Decimal(GL_DEFAULTS.MIN_COGS_THRESHOLD))) {
      transactions.push(
        {
          accountId: parseInt(GL_ACCOUNTS.COGS),
          debitAmount: totalCOGS.toString(),
          creditAmount: '0',
          description: 'Cost of goods sold',
        },
        {
          accountId: parseInt(GL_ACCOUNTS.INVENTORY),
          debitAmount: '0',
          creditAmount: totalCOGS.toString(),
          description: 'Inventory reduction',
        }
      );
    }

    // Create journal entry with retry logic
    return await this.createJournalEntryWithRetry(tx, {
      entryDate: new Date(),
      description: `Revenue recognition - Order #${order.id}`,
      sourceType: 'order_delivery',
      sourceId: order.id,
      createdBy: userId,
      transactions: {
        create: transactions.map(txn => ({
          accountId: txn.accountId,
          debitAmount: new Prisma.Decimal(txn.debitAmount),
          creditAmount: new Prisma.Decimal(txn.creditAmount),
          description: txn.description,
        })),
      },
    });
  }

  /**
   * Create failed delivery expense GL entry
   *
   * Records operational cost of failed delivery:
   * - Debit: Failed Delivery Expense
   * - Credit: Cash in Hand
   *
   * @param tx - Prisma transaction client
   * @param delivery - Delivery record
   * @param order - Associated order
   * @param userId - ID of user creating the entry
   * @returns Created journal entry
   */
  static async createFailedDeliveryEntry(
    tx: Prisma.TransactionClient,
    delivery: Delivery,
    order: Order,
    userId: number
  ): Promise<any> {
    // Use default failed delivery fee as operational cost
    const expenseAmount = new Decimal(GL_DEFAULTS.FAILED_DELIVERY_FEE);

    const transactions = [
      {
        accountId: parseInt(GL_ACCOUNTS.FAILED_DELIVERY_EXPENSE),
        debitAmount: expenseAmount.toString(),
        creditAmount: '0',
        description: `Failed delivery - Order #${order.id}`,
      },
      {
        accountId: parseInt(GL_ACCOUNTS.CASH_IN_HAND),
        debitAmount: '0',
        creditAmount: expenseAmount.toString(),
        description: 'Cash impact of failed delivery',
      },
    ];

    // Create journal entry with retry logic
    return await this.createJournalEntryWithRetry(tx, {
      entryDate: new Date(),
      description: `Failed delivery expense - Order #${order.id}`,
      sourceType: 'order_delivery',
      sourceId: delivery.id,
      createdBy: userId,
      transactions: {
        create: transactions.map(txn => ({
          accountId: txn.accountId,
          debitAmount: new Prisma.Decimal(txn.debitAmount),
          creditAmount: new Prisma.Decimal(txn.creditAmount),
          description: txn.description,
        })),
      },
    });
  }

  /**
   * Create return reversal GL entry
   *
   * Reverses the original revenue recognition entry and optionally adds return processing expense:
   * - Credit: Cash in Transit (reversal - return net cash)
   * - Credit: Delivery Agent Commission Expense (reversal)
   * - Credit: Sales Rep Commission Expense (reversal)
   * - Debit: Product Revenue (reversal - return revenue)
   * - Debit: Inventory (if COGS was recorded)
   * - Credit: COGS (if COGS was recorded)
   * - Debit: Return Processing Expense (if returnProcessingFee provided)
   * - Credit: Refund Liability (if returnProcessingFee provided)
   *
   * @param tx - Prisma transaction client
   * @param order - Order with items and products
   * @param originalEntry - Original revenue recognition journal entry
   * @param userId - ID of user creating the entry
   * @param returnProcessingFee - Optional return processing fee (varies per case)
   * @returns Created journal entry
   */
  static async createReturnReversalEntry(
    tx: Prisma.TransactionClient,
    order: OrderWithItems,
    originalEntry: any,
    userId: number,
    returnProcessingFee?: number
  ): Promise<any> {
    const orderAmount = new Decimal(order.totalAmount);

    // Fetch delivery agent's commission (same as original entry)
    const deliveryAgent = order.deliveryAgentId
      ? await tx.user.findUnique({
        where: { id: order.deliveryAgentId },
        select: { id: true, commissionAmount: true } as any,
      })
      : null;

    // Fetch sales rep's commission (same as original entry)
    const salesRep = order.customerRepId
      ? await tx.user.findUnique({
        where: { id: order.customerRepId },
        select: { id: true, commissionAmount: true } as any,
      })
      : null;

    // Commission amounts (same as original entry)
    const deliveryCommission = deliveryAgent
      ? (new Decimal((deliveryAgent as any).commissionAmount || 0))
      : new Decimal(0);

    const salesRepCommission = salesRep
      ? (new Decimal((salesRep as any).commissionAmount || 0))
      : new Decimal(0);

    // Calculate net cash (same as original entry)
    const totalCommissions = deliveryCommission.plus(salesRepCommission);
    const cashInTransit = orderAmount.minus(totalCommissions);

    // Calculate total COGS to determine if we need to reverse COGS/inventory
    const totalCOGS = this.calculateTotalCOGS(order.orderItems);

    // Build reversal transactions (flip debits/credits from original entry)
    const transactions: any[] = [
      {
        accountId: parseInt(GL_ACCOUNTS.CASH_IN_TRANSIT),
        debitAmount: '0',
        creditAmount: cashInTransit.toString(),
        description: 'Cash in transit reversal',
      },
      {
        accountId: parseInt(GL_ACCOUNTS.PRODUCT_REVENUE),
        debitAmount: orderAmount.toString(),
        creditAmount: '0',
        description: 'Product revenue reversal',
      },
    ];

    // Reverse delivery agent commission expense if applicable
    if (deliveryCommission.greaterThan(0)) {
      transactions.push({
        accountId: parseInt(GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION),
        debitAmount: '0',
        creditAmount: deliveryCommission.toString(),
        description: 'Delivery agent commission reversal',
      });
    }

    // Reverse sales rep commission expense if applicable
    if (salesRepCommission.greaterThan(0)) {
      transactions.push({
        accountId: parseInt(GL_ACCOUNTS.SALES_REP_COMMISSION),
        debitAmount: '0',
        creditAmount: salesRepCommission.toString(),
        description: 'Sales representative commission reversal',
      });
    }

    // Reverse COGS and restore inventory if COGS was recorded
    if (totalCOGS.greaterThan(new Decimal(GL_DEFAULTS.MIN_COGS_THRESHOLD))) {
      transactions.push(
        {
          accountId: parseInt(GL_ACCOUNTS.INVENTORY),
          debitAmount: totalCOGS.toString(),
          creditAmount: '0',
          description: 'Inventory restoration',
        },
        {
          accountId: parseInt(GL_ACCOUNTS.COGS),
          debitAmount: '0',
          creditAmount: totalCOGS.toString(),
          description: 'COGS reversal',
        }
      );
    }

    // Add return processing expense if provided
    if (returnProcessingFee && returnProcessingFee > 0) {
      const processingFee = new Decimal(returnProcessingFee);
      transactions.push(
        {
          accountId: parseInt(GL_ACCOUNTS.RETURN_PROCESSING_EXPENSE),
          debitAmount: processingFee.toString(),
          creditAmount: '0',
          description: 'Return processing cost',
        },
        {
          accountId: parseInt(GL_ACCOUNTS.REFUND_LIABILITY),
          debitAmount: '0',
          creditAmount: processingFee.toString(),
          description: 'Customer refund pending',
        }
      );
    }

    // Create journal entry with retry logic
    return await this.createJournalEntryWithRetry(tx, {
      entryDate: new Date(),
      description: `Return reversal - Order #${order.id} (Original JE: ${originalEntry?.entryNumber || 'N/A'})`,
      sourceType: 'order_return' as any,
      sourceId: order.id,
      createdBy: userId,
      transactions: {
        create: transactions.map(txn => ({
          accountId: txn.accountId,
          debitAmount: new Prisma.Decimal(txn.debitAmount),
          creditAmount: new Prisma.Decimal(txn.creditAmount),
          description: txn.description,
        })),
      },
    });
  }

  /**
   * Restore inventory quantities when order is returned
   *
   * Increases product stock quantities by the amounts in the order
   *
   * @param tx - Prisma transaction client
   * @param orderItems - Array of order items with product information
   */
  static async restoreInventory(
    tx: Prisma.TransactionClient,
    orderItems: OrderItemWithProduct[]
  ): Promise<void> {
    for (const item of orderItems) {
      await tx.product.update({
        where: { id: item.productId },
        data: {
          stockQuantity: {
            increment: item.quantity,
          },
        },
      });

      logger.info(`Restored inventory for product ${item.product.name}: +${item.quantity} units`);
    }
  }

  /**
   * Check if order revenue has already been recognized
   * Prevents duplicate GL entries
   *
   * @param order - Order to check
   * @returns True if revenue already recognized
   */
  static isRevenueAlreadyRecognized(order: any): boolean {
    return (order as any).revenueRecognized === true;
  }

  /**
   * Log warning for products missing COGS
   *
   * @param orderId - Order ID for logging context
   * @param missingProducts - List of product names without COGS
   */
  static logMissingCOGS(orderId: number, missingProducts: string[]): void {
    logger.warn(
      `Order ${orderId}: Missing COGS for products: ${missingProducts.join(', ')}. ` +
      `Using COGS = 0 for these products. Update product COGS in admin panel.`
    );
  }

  /**
   * Verify that all required GL accounts exist in the database
   * Used at system startup
   */
  static async verifyGLAccounts(): Promise<boolean> {
    try {
      const requiredAccounts = Object.values(GL_ACCOUNTS).map(acc => (acc as any).code);
      const accounts = await prisma.account.findMany({
        where: {
          code: { in: requiredAccounts }
        },
        select: { code: true }
      });

      const foundAccountCodes = new Set(accounts.map(a => a.code));
      const missingAccounts = requiredAccounts.filter(code => !foundAccountCodes.has(code));

      if (missingAccounts.length > 0) {
        logger.error('CRITICAL: Missing required GL accounts in database:', missingAccounts);
        return false;
      }

      logger.info('GL accounts validated successfully.');
      return true;
    } catch (error) {
      logger.error('Failed to verify GL accounts:', error);
      return false;
    }
  }
}
