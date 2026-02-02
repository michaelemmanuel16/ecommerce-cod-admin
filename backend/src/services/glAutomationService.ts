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

import { Prisma, Order, OrderItem, Product, Delivery, Customer, User, JournalEntry, AccountTransaction, JournalSourceType, AgentDeposit } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { GL_ACCOUNTS, GL_DEFAULTS } from '../config/glAccounts';
import { GLAccountService } from './glAccountService';
import logger from '../utils/logger';
import prisma from '../utils/prisma';
import { GLUtils } from '../utils/glUtils';
// import { SYSTEM_USER_ID } from '../config/constants'; // Commented out unused variable to resolve lint error

// Define JournalSourceType locally if not correctly imported or use string literal
// type JournalSourceType = 'order_delivery' | 'failed_delivery' | 'order_return' | 'manual' | 'agent_collection'; // Commented out unused type to resolve lint error

// Type for order items with product information
type OrderItemWithProduct = OrderItem & { product: Product };

// Type for orders with items and products (now strictly required for GL automation)
export interface OrderWithItems extends Order {
  orderItems: OrderItemWithProduct[];
  customer: Customer;
  deliveryAgent: User | null;
  customerRep: User | null;
}

// Interface for transaction data before creation
interface TransactionCreateData {
  accountId: number;
  debitAmount: Decimal;
  creditAmount: Decimal;
  description: string;
}

// Interface for journal entry data before creation
interface JournalEntryCreateData {
  entryDate: Date;
  description: string;
  sourceType: JournalSourceType;
  sourceId: number;
  createdBy: number;
  transactions: {
    create: TransactionCreateData[];
  };
}

// Type for journal entry with its transactions and account info
export type JournalEntryWithTransactions = JournalEntry & {
  transactions: (AccountTransaction & {
    account: {
      id: number;
      code: string;
      name: string;
    };
  })[];
};

/**
 * GL Automation Service
 * Static methods for creating automated GL entries
 */
export class GLAutomationService {
  /**
   * Update account balance atomically within a transaction
   * 
   * @param tx - Prisma transaction client
   * @param accountId - ID of account to update
   * @param debitAmount - Amount to debit
   * @param creditAmount - Amount to credit
   * @returns The new account balance
   */
  private static async updateAccountBalance(
    tx: Prisma.TransactionClient,
    accountId: number,
    debitAmount: Decimal,
    creditAmount: Decimal
  ): Promise<Decimal> {
    const account = await tx.account.findUnique({
      where: { id: accountId },
      select: { normalBalance: true, currentBalance: true }
    });

    if (!account) {
      throw new Error(`Account ${accountId} not found during balance update`);
    }

    let balanceChange: Decimal;
    if (account.normalBalance === 'debit') {
      balanceChange = debitAmount.minus(creditAmount);
    } else {
      balanceChange = creditAmount.minus(debitAmount);
    }

    const newBalance = (account.currentBalance as unknown as Decimal).plus(balanceChange);

    await tx.account.update({
      where: { id: accountId },
      data: {
        currentBalance: newBalance as any
      }
    });

    return newBalance;
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
    data: JournalEntryCreateData
  ): Promise<JournalEntryWithTransactions> {
    const maxRetries = 5;
    let retries = 0;
    let lastError: any;

    while (retries < maxRetries) {
      try {
        const entryNumber = await GLUtils.generateEntryNumber(tx);

        // First, update account balances and get running balances
        const transactionsWithRunningBalances = [];
        for (const txn of data.transactions.create) {
          const runningBalance = await this.updateAccountBalance(
            tx,
            txn.accountId,
            txn.debitAmount,
            txn.creditAmount
          );

          transactionsWithRunningBalances.push({
            ...txn,
            runningBalance
          });
        }

        return await tx.journalEntry.create({
          data: {
            ...data,
            entryNumber,
            transactions: {
              create: transactionsWithRunningBalances
            }
          },
          include: {
            transactions: {
              include: {
                account: true
              }
            }
          }
        }) as JournalEntryWithTransactions;
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
  ): Promise<JournalEntryWithTransactions> {
    const orderAmount = new Decimal(order.totalAmount.toString());

    const deliveryAgent = order.deliveryAgent;
    const salesRep = order.customerRep;

    const deliveryCommission: Decimal = deliveryAgent?.commissionAmount
      ? new Decimal(deliveryAgent.commissionAmount.toString())
      : new Decimal(0);
    const salesRepCommission: Decimal = salesRep?.commissionAmount
      ? new Decimal(salesRep.commissionAmount.toString())
      : new Decimal(0);

    // Build journal entry transactions
    // Note: Cash in Transit = Gross Amount - Agent Commission
    // Commissions Payable = Sales Rep Commission (since they don't hold the cash)
    const agentComm = deliveryCommission;
    const repComm = salesRepCommission;
    const netCashInTransit = orderAmount.minus(agentComm);

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_TRANSIT),
        debitAmount: netCashInTransit,
        creditAmount: new Decimal(0),
        description: `Net collection held by agent for order ${order.id} (Gross ${orderAmount} - Agent Comm ${agentComm})`,
      },
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.PRODUCT_REVENUE),
        debitAmount: new Decimal(0),
        creditAmount: orderAmount,
        description: 'Product sales revenue (Gross)',
      },
    ];

    if (agentComm.greaterThan(0)) {
      transactions.push({
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION),
        debitAmount: agentComm,
        creditAmount: new Decimal(0),
        description: 'Delivery agent commission expense',
      });
    }

    if (repComm.greaterThan(0)) {
      transactions.push({
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.SALES_REP_COMMISSION),
        debitAmount: repComm,
        creditAmount: new Decimal(0),
        description: 'Sales representative commission expense',
      });

      transactions.push({
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.COMMISSIONS_PAYABLE),
        debitAmount: new Decimal(0),
        creditAmount: repComm,
        description: 'Accrued commissions payable to sales rep',
      });
    }

    if (totalCOGS.greaterThan(new Decimal(GL_DEFAULTS.MIN_COGS_THRESHOLD))) {
      transactions.push(
        {
          accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.COGS),
          debitAmount: totalCOGS,
          creditAmount: new Decimal(0),
          description: 'Cost of goods sold',
        },
        {
          accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.INVENTORY),
          debitAmount: new Decimal(0),
          creditAmount: totalCOGS,
          description: 'Inventory reduction',
        }
      );
    }

    return await this.createJournalEntryWithRetry(tx, {
      entryDate: new Date(),
      description: `Revenue recognition - Order #${order.id}`,
      sourceType: JournalSourceType.order_delivery,
      sourceId: order.id,
      createdBy: userId,
      transactions: {
        create: transactions,
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
  ): Promise<JournalEntryWithTransactions> {
    // Use default failed delivery fee as operational cost
    const expenseAmount = new Decimal(GL_DEFAULTS.FAILED_DELIVERY_FEE);

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.FAILED_DELIVERY_EXPENSE),
        debitAmount: expenseAmount,
        creditAmount: new Decimal(0),
        description: `Failed delivery - Order #${order.id}`,
      },
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_HAND),
        debitAmount: new Decimal(0),
        creditAmount: expenseAmount,
        description: 'Cash impact of failed delivery',
      },
    ];

    return await this.createJournalEntryWithRetry(tx, {
      entryDate: new Date(),
      description: `Failed delivery expense - Order #${order.id}`,
      sourceType: JournalSourceType.order_delivery,
      sourceId: delivery.id,
      createdBy: userId,
      transactions: {
        create: transactions,
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
    originalEntry: JournalEntryWithTransactions,
    userId: number,
    returnProcessingFee?: number
  ): Promise<JournalEntryWithTransactions> {
    const orderAmount = new Decimal(order.totalAmount.toString());

    const deliveryAgent = order.deliveryAgent;
    const salesRep = order.customerRep;

    const deliveryCommission: Decimal = deliveryAgent?.commissionAmount
      ? new Decimal(deliveryAgent.commissionAmount.toString())
      : new Decimal(0);
    const salesRepCommission: Decimal = salesRep?.commissionAmount
      ? new Decimal(salesRep.commissionAmount.toString())
      : new Decimal(0);

    // Calculate total COGS to determine if we need to reverse COGS/inventory
    const totalCOGS = this.calculateTotalCOGS(order.orderItems);

    // Build reversal transactions (flip debits/credits from original entry)
    const agentComm = deliveryCommission;
    const repComm = salesRepCommission;
    const netCashInTransit = orderAmount.minus(agentComm);

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_TRANSIT),
        debitAmount: new Decimal(0),
        creditAmount: netCashInTransit,
        description: 'Cash in transit reversal (Net)',
      },
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.PRODUCT_REVENUE),
        debitAmount: orderAmount,
        creditAmount: new Decimal(0),
        description: 'Product revenue reversal',
      },
    ];

    if (agentComm.greaterThan(0)) {
      transactions.push({
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION),
        debitAmount: new Decimal(0),
        creditAmount: agentComm,
        description: 'Delivery agent commission reversal',
      });
    }

    if (repComm.greaterThan(0)) {
      transactions.push({
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.SALES_REP_COMMISSION),
        debitAmount: new Decimal(0),
        creditAmount: repComm,
        description: 'Sales representative commission reversal',
      });

      transactions.push({
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.COMMISSIONS_PAYABLE),
        debitAmount: repComm,
        creditAmount: new Decimal(0),
        description: 'Accrued commissions payable reversal',
      });
    }

    if (totalCOGS.greaterThan(new Decimal(GL_DEFAULTS.MIN_COGS_THRESHOLD))) {
      transactions.push(
        {
          accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.INVENTORY),
          debitAmount: totalCOGS,
          creditAmount: new Decimal(0),
          description: 'Inventory restoration',
        },
        {
          accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.COGS),
          debitAmount: new Decimal(0),
          creditAmount: totalCOGS,
          description: 'COGS reversal',
        }
      );
    }

    if (returnProcessingFee && returnProcessingFee > 0) {
      const processingFee = new Decimal(returnProcessingFee);
      transactions.push(
        {
          accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.RETURN_PROCESSING_EXPENSE),
          debitAmount: processingFee,
          creditAmount: new Decimal(0),
          description: 'Return processing cost',
        },
        {
          accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.REFUND_LIABILITY),
          debitAmount: new Decimal(0),
          creditAmount: processingFee,
          description: 'Customer refund pending',
        }
      );
    }

    return await this.createJournalEntryWithRetry(tx, {
      entryDate: new Date(),
      description: `Return reversal - Order #${order.id} (Original JE: ${originalEntry?.entryNumber || 'N/A'})`,
      sourceType: JournalSourceType.order_return,
      sourceId: order.id,
      createdBy: userId,
      transactions: {
        create: transactions,
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
  static isRevenueAlreadyRecognized(order: Order): boolean {
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
   * Create GL entry for collection verification (Reconciliation)
   *
   * Moves funds from Cash in Transit to Cash in Hand:
   * - Debit: Cash in Hand
   * - Credit: Cash in Transit
   *
   * @param tx - Prisma transaction client
   * @param collection - Agent collection record
   * @param userId - ID of user verifying the collection
   * @returns Created journal entry
   */
  static async createCollectionVerificationEntry(
    tx: Prisma.TransactionClient,
    collection: any,
    userId: number
  ): Promise<JournalEntryWithTransactions> {
    const amount = new Decimal(collection.amount.toString());

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_HAND),
        debitAmount: amount,
        creditAmount: new Decimal(0),
        description: `Collection reconciled - Order #${collection.orderId}`,
      },
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_TRANSIT),
        debitAmount: new Decimal(0),
        creditAmount: amount,
        description: `Movement from transit to hand - Order #${collection.orderId}`,
      },
    ];

    return await this.createJournalEntryWithRetry(tx, {
      entryDate: new Date(),
      description: `Collection reconciliation - Order #${collection.orderId}`,
      sourceType: JournalSourceType.agent_collection,
      sourceId: collection.id,
      createdBy: userId,
      transactions: {
        create: transactions,
      },
    });
  }

  /**
   * Create GL entry for agent deposit verification
   *
   * Records receipt of cash from agent and reduction of their receivable:
   * - Debit: Cash in Hand (usually bank or actual cash vault)
   * - Credit: Accounts Receivable - Agents
   *
   * @param tx - Prisma transaction client
   * @param deposit - Agent deposit record
   * @param userId - ID of user verifying the deposit
   * @returns Created journal entry
   */
  static async createAgentDepositEntry(
    tx: Prisma.TransactionClient,
    deposit: AgentDeposit,
    userId: number
  ): Promise<JournalEntryWithTransactions> {
    const depositAmount = new Decimal(deposit.amount.toString());

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_HAND),
        debitAmount: depositAmount,
        creditAmount: new Decimal(0),
        description: `Deposit verification - Agent #${deposit.agentId} (Ref: ${deposit.referenceNumber})`,
      },
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.AR_AGENTS),
        debitAmount: new Decimal(0),
        creditAmount: depositAmount,
        description: `Deposit matching - Agent #${deposit.agentId}`,
      },
    ];

    return await this.createJournalEntryWithRetry(tx, {
      entryDate: new Date(),
      description: `Agent deposit verification - Ref #${deposit.referenceNumber}`,
      sourceType: JournalSourceType.agent_deposit,
      sourceId: deposit.id,
      createdBy: userId,
      transactions: {
        create: transactions,
      },
    });
  }

  /**
   * Verify that all required GL accounts exist in the database.
   * If missing, attempts to create them (auto-seeding).
   * Used at system startup.
   */
  static async asyncVerifyGLAccounts(): Promise<boolean> {
    try {
      const requiredAccountCodes = Object.values(GL_ACCOUNTS);
      const accounts = await prisma.account.findMany({
        where: {
          code: { in: [...requiredAccountCodes] }
        },
        select: { code: true }
      });

      const foundAccountCodes = new Set(accounts.map(a => a.code));
      const missingAccounts = [...requiredAccountCodes].filter(code => !foundAccountCodes.has(code));

      if (missingAccounts.length > 0) {
        logger.warn('Some required GL accounts are missing. Attempting to auto-seed:', missingAccounts);

        // Map codes back to keys to get names/types for creation
        const defaultNames: Record<string, { name: string; type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'; balance: 'debit' | 'credit' }> = {
          [GL_ACCOUNTS.CASH_IN_HAND]: { name: 'Cash in Hand', type: 'asset', balance: 'debit' },
          [GL_ACCOUNTS.CASH_IN_TRANSIT]: { name: 'Cash in Transit', type: 'asset', balance: 'debit' },
          [GL_ACCOUNTS.AR_AGENTS]: { name: 'Accounts Receivable - Agents', type: 'asset', balance: 'debit' },
          [GL_ACCOUNTS.INVENTORY]: { name: 'Inventory', type: 'asset', balance: 'debit' },
          [GL_ACCOUNTS.PRODUCT_REVENUE]: { name: 'Product Sales Revenue', type: 'revenue', balance: 'credit' },
          [GL_ACCOUNTS.COGS]: { name: 'Cost of Goods Sold', type: 'expense', balance: 'debit' },
          [GL_ACCOUNTS.FAILED_DELIVERY_EXPENSE]: { name: 'Failed Delivery Expense', type: 'expense', balance: 'debit' },
          [GL_ACCOUNTS.RETURN_PROCESSING_EXPENSE]: { name: 'Return Processing Expense', type: 'expense', balance: 'debit' },
          [GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION]: { name: 'Delivery Agent Commission', type: 'expense', balance: 'debit' },
          [GL_ACCOUNTS.SALES_REP_COMMISSION]: { name: 'Sales Rep Commission', type: 'expense', balance: 'debit' },
          [GL_ACCOUNTS.REFUND_LIABILITY]: { name: 'Refund Liability', type: 'liability', balance: 'credit' },
        };

        for (const code of missingAccounts) {
          const info = defaultNames[code];
          if (info) {
            await prisma.account.create({
              data: {
                code,
                name: info.name,
                accountType: info.type,
                normalBalance: info.balance,
                description: `Automatically created during system startup: ${info.name}`,
                isActive: true,
              },
            });
            logger.info(`Successfully auto-seeded missing account: ${code} (${info.name})`);
          } else {
            logger.error(`Critical error: No metadata found for missing GL account code: ${code}`);
            return false;
          }
        }
      }

      logger.info('GL accounts validated and ready.');
      return true;
    } catch (error) {
      logger.error('Failed to verify/seed GL accounts:', error);
      return false;
    }
  }
}
