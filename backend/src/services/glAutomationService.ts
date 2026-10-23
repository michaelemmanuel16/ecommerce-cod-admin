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

import { Prisma, Order, OrderItem, Product, Customer, User, JournalEntry, AccountTransaction, JournalSourceType, AgentDeposit, InventoryShipment } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { BALANCE_TOLERANCE, GL_ACCOUNTS, GL_DEFAULTS } from '../config/glAccounts';
import { GLAccountService } from './glAccountService';
import logger from '../utils/logger';
import { GLUtils } from '../utils/glUtils';
import { getTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';

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
  sourceId?: number;
  /** Outside id (a payout reference). Unique per tenant and source type; a repeat is a P2002 the caller sees. */
  externalRef?: string;
  createdBy: number;
  // Tenant that owns this entry. Pass explicitly (e.g. order.tenantId) so the
  // GL write is correct regardless of execution context. Background callers
  // (reconciliation cron, queues, setImmediate) have no AsyncLocalStorage
  // tenant context, so relying on getTenantId() alone silently orphans the
  // nested account_transactions with tenant_id = NULL. See createJournalEntryWithRetry.
  tenantId?: string;
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

/** The order shape GL posting and the financial sync read: full customer, agent, rep, items with products. */
export const ORDER_GL_INCLUDE = {
  customer: true,
  deliveryAgent: true,
  customerRep: true,
  orderItems: { include: { product: true } },
} as const;

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
  /**
   * Validates that journal entry transactions are balanced (debits = credits).
   * Throws if the imbalance exceeds 0.01 tolerance.
   */
  private static validateJournalEntryBalance(transactions: Array<{ debitAmount: number | Decimal; creditAmount: number | Decimal }>): void {
    const totalDebits = Money.sum(transactions.map((t) => t.debitAmount));
    const totalCredits = Money.sum(transactions.map((t) => t.creditAmount));
    const imbalance = totalDebits.minus(totalCredits).abs();
    if (imbalance.greaterThan(BALANCE_TOLERANCE)) {
      throw new Error(`Journal entry is unbalanced: debits=${totalDebits.toFixed(4)}, credits=${totalCredits.toFixed(4)}, difference=${imbalance.toFixed(4)}`);
    }
  }

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

        // Validate balance before writing
        GLAutomationService.validateJournalEntryBalance(data.transactions.create);

        // Resolve the owning tenant explicitly. Prefer the value the caller
        // threaded in (e.g. order.tenantId), falling back to ambient context
        // for request-scoped callers (manual entries). The Prisma tenant
        // extension only injects tenantId into the TOP-LEVEL create, never the
        // nested transactions.create — so children must be stamped here.
        // Fail loud rather than write tenant_id = NULL: a missing tenant means
        // financial rows that silently disappear from tenant-scoped reporting.
        const { tenantId: explicitTenantId, ...entryData } = data;
        const tenantId = explicitTenantId ?? getTenantId();
        if (!tenantId) {
          throw new Error(
            `Cannot create GL journal entry (source ${data.sourceType}#${data.sourceId}) without a tenantId. ` +
            `Pass tenantId explicitly (e.g. order.tenantId) or run within tenant context.`
          );
        }

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
            runningBalance,
            tenantId,
          });
        }

        return await tx.journalEntry.create({
          data: {
            ...entryData,
            tenantId,
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
        // Only the entry-number key is retried. Any other unique key (an external_ref repeat) is the caller's answer.
        const target = JSON.stringify(error.meta?.target ?? '');
        if (error.code === 'P2002' && target.includes('entry_number') && !target.includes('external_ref')) {
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
    return Money.sum(orderItems.map((item) => Money.mul(Money.orZero(item.product.cogs), item.quantity)));
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
      if (!Money.isNonZero(item.product.cogs)) {
        missingProducts.push(item.product.name);
      }
    }

    return {
      valid: missingProducts.length === 0,
      missingProducts,
    };
  }

  /**
   * The order's active revenue entry: not voided and not reversed (D7), so a returned order has none
   * and may be delivered again. Include is what `createReturnReversalEntry` needs.
   */
  static async findActiveRevenueEntry(tx: Prisma.TransactionClient, orderId: number) {
    return tx.journalEntry.findFirst({
      where: { sourceType: JournalSourceType.order_delivery, sourceId: orderId, isVoided: false, reversingEntryId: null },
      include: { transactions: { include: { account: true } } },
      orderBy: { createdAt: 'desc' },
    });
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
    // Idempotency guard — prevent duplicate GL entries for the same order
    const existingEntry = await this.findActiveRevenueEntry(tx, order.id);
    if (existingEntry) {
      logger.warn(`Skipping duplicate GL entry for order ${order.id}: ${existingEntry.entryNumber} already exists`);
      return existingEntry as JournalEntryWithTransactions;
    }

    const orderAmount = Money.parse(order.totalAmount);

    const deliveryAgent = order.deliveryAgent;
    const salesRep = order.customerRep;

    // Uses profile flat rate — must match draft collection creation in deliveryService
    const deliveryCommission = Money.orZero(deliveryAgent?.commissionAmount);
    const salesRepCommission = Money.orZero(salesRep?.commissionAmount);

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
        creditAmount: Money.ZERO,
        description: `Net collection held by agent for order ${order.id} (Gross ${orderAmount} - Agent Comm ${agentComm})`,
      },
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.PRODUCT_REVENUE),
        debitAmount: Money.ZERO,
        creditAmount: orderAmount,
        description: 'Product sales revenue (Gross)',
      },
    ];

    if (agentComm.greaterThan(0)) {
      transactions.push({
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION),
        debitAmount: agentComm,
        creditAmount: Money.ZERO,
        description: 'Delivery agent commission expense',
      });
    }

    if (repComm.greaterThan(0)) {
      transactions.push({
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.SALES_REP_COMMISSION),
        debitAmount: repComm,
        creditAmount: Money.ZERO,
        description: 'Sales representative commission expense',
      });

      transactions.push({
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.COMMISSIONS_PAYABLE),
        debitAmount: Money.ZERO,
        creditAmount: repComm,
        description: 'Accrued commissions payable to sales rep',
      });
    }

    if (totalCOGS.greaterThan(new Decimal(GL_DEFAULTS.MIN_COGS_THRESHOLD))) {
      transactions.push(
        {
          accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.COGS),
          debitAmount: totalCOGS,
          creditAmount: Money.ZERO,
          description: 'Cost of goods sold',
        },
        {
          accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.INVENTORY),
          debitAmount: Money.ZERO,
          creditAmount: totalCOGS,
          description: 'Inventory reduction',
        }
      );
    }

    return await this.createJournalEntryWithRetry(tx, {
      entryDate: order.deliveryDate || new Date(),
      description: `Revenue recognition - Order #${order.id}`,
      sourceType: JournalSourceType.order_delivery,
      sourceId: order.id,
      createdBy: userId,
      // Stamp the entry with the order's tenant so the GL write is correct even
      // when run from the reconciliation cron / setImmediate (no ALS context).
      tenantId: (order as any).tenantId ?? undefined,
      transactions: {
        create: transactions,
      },
    });
  }

  /**
   * Failed-attempt fee entry, one per `failed_delivery` move (D6, F-935). The fee is the FeeRule of the
   * order's delivery agent with outcome `failed`; no agent or no rule means 0 and nothing is posted.
   * Keyed on the OrderHistory row of the move, so a repeat of the same move posts nothing and two
   * attempts post two entries. Accounts: 5020 / cash in hand.
   */
  static async createFailedAttemptEntry(
    tx: Prisma.TransactionClient,
    order: { id: number; tenantId?: string | null; deliveryAgentId?: number | null },
    historyId: number,
    userId: number,
    entryDate: Date = new Date()
  ): Promise<JournalEntryWithTransactions | null> {
    const rule = order.deliveryAgentId
      ? await tx.feeRule.findFirst({
          where: {
            partnerUserId: order.deliveryAgentId,
            outcome: 'failed',
            ...(order.tenantId ? { tenantId: order.tenantId } : {}),
          },
        })
      : null;
    const fee = rule ? Money.parse(rule.amount) : Money.ZERO;
    if (!fee.greaterThan(0)) return null;

    const existingEntry = await tx.journalEntry.findFirst({
      where: { sourceType: JournalSourceType.order_failed_delivery, sourceId: historyId, isVoided: false },
      include: { transactions: { include: { account: true } } }
    });
    if (existingEntry) return existingEntry as JournalEntryWithTransactions;

    const [expenseAccountId, cashAccountId] = await Promise.all([
      GLAccountService.getAccountIdByCode(GL_ACCOUNTS.FAILED_DELIVERY_EXPENSE),
      GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_HAND),
    ]);
    return await this.createJournalEntryWithRetry(tx, {
      entryDate,
      description: `Failed delivery expense - Order #${order.id}`,
      sourceType: JournalSourceType.order_failed_delivery,
      sourceId: historyId,
      createdBy: userId,
      tenantId: order.tenantId ?? undefined,
      transactions: {
        create: [
          {
            accountId: expenseAccountId,
            debitAmount: fee,
            creditAmount: Money.ZERO,
            description: `Failed delivery - Order #${order.id}`,
          },
          {
            accountId: cashAccountId,
            debitAmount: Money.ZERO,
            creditAmount: fee,
            description: 'Cash impact of failed delivery',
          },
        ],
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
    returnProcessingFee?: Money.MoneyInput,
    entryDate?: Date
  ): Promise<JournalEntryWithTransactions> {
    const orderAmount = Money.parse(order.totalAmount);

    const deliveryAgent = order.deliveryAgent;
    const salesRep = order.customerRep;

    // Uses profile flat rate — must match draft collection creation in deliveryService
    const deliveryCommission = Money.orZero(deliveryAgent?.commissionAmount);
    const salesRepCommission = Money.orZero(salesRep?.commissionAmount);

    // Calculate total COGS to determine if we need to reverse COGS/inventory
    const totalCOGS = this.calculateTotalCOGS(order.orderItems);

    // Build reversal transactions (flip debits/credits from original entry)
    const agentComm = deliveryCommission;
    const repComm = salesRepCommission;
    const netCashInTransit = orderAmount.minus(agentComm);

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_TRANSIT),
        debitAmount: Money.ZERO,
        creditAmount: netCashInTransit,
        description: 'Cash in transit reversal (Net)',
      },
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.PRODUCT_REVENUE),
        debitAmount: orderAmount,
        creditAmount: Money.ZERO,
        description: 'Product revenue reversal',
      },
    ];

    if (agentComm.greaterThan(0)) {
      transactions.push({
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION),
        debitAmount: Money.ZERO,
        creditAmount: agentComm,
        description: 'Delivery agent commission reversal',
      });
    }

    if (repComm.greaterThan(0)) {
      transactions.push({
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.SALES_REP_COMMISSION),
        debitAmount: Money.ZERO,
        creditAmount: repComm,
        description: 'Sales representative commission reversal',
      });

      transactions.push({
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.COMMISSIONS_PAYABLE),
        debitAmount: repComm,
        creditAmount: Money.ZERO,
        description: 'Accrued commissions payable reversal',
      });
    }

    if (totalCOGS.greaterThan(new Decimal(GL_DEFAULTS.MIN_COGS_THRESHOLD))) {
      transactions.push(
        {
          accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.INVENTORY),
          debitAmount: totalCOGS,
          creditAmount: Money.ZERO,
          description: 'Inventory restoration',
        },
        {
          accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.COGS),
          debitAmount: Money.ZERO,
          creditAmount: totalCOGS,
          description: 'COGS reversal',
        }
      );
    }

    const processingFee = Money.tryParse(returnProcessingFee);
    if (processingFee && processingFee.gt(0)) {
      transactions.push(
        {
          accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.RETURN_PROCESSING_EXPENSE),
          debitAmount: processingFee,
          creditAmount: Money.ZERO,
          description: 'Return processing cost',
        },
        {
          accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.REFUND_LIABILITY),
          debitAmount: Money.ZERO,
          creditAmount: processingFee,
          description: 'Customer refund pending',
        }
      );
    }

    const reversal = await this.createJournalEntryWithRetry(tx, {
      entryDate: entryDate ?? order.returnedAt ?? new Date(),
      description: `Return reversal - Order #${order.id} (Original JE: ${originalEntry?.entryNumber || 'N/A'})`,
      sourceType: JournalSourceType.order_return,
      sourceId: order.id,
      createdBy: userId,
      tenantId: (order as any).tenantId ?? undefined,
      transactions: {
        create: transactions,
      },
    });

    if (originalEntry?.id) {
      await tx.journalEntry.update({
        where: { id: originalEntry.id },
        data: { reversingEntryId: reversal.id },
      });
    }
    return reversal;
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
    // Idempotency guard — prevent duplicate GL entries for the same collection
    const existingEntry = await tx.journalEntry.findFirst({
      where: {
        sourceType: JournalSourceType.agent_collection,
        sourceId: collection.id,
        isVoided: false
      },
      include: { transactions: { include: { account: true } } }
    });
    if (existingEntry) {
      logger.warn(`Skipping duplicate GL entry for collection ${collection.id}: ${existingEntry.entryNumber} already exists`);
      return existingEntry as JournalEntryWithTransactions;
    }

    const amount = Money.parse(collection.amount);

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_HAND),
        debitAmount: amount,
        creditAmount: Money.ZERO,
        description: `Collection reconciled - Order #${collection.orderId}`,
      },
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_TRANSIT),
        debitAmount: Money.ZERO,
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
   * Create GL journal entry for a recorded expense
   *
   * DR: Operating Expense (5100) = amount
   * CR: Cash in Hand (1010)      = amount
   *
   * @param tx - Prisma transaction client
   * @param expenseId - ID of the expense record
   * @param amount - Expense amount
   * @param description - Expense description
   * @param userId - ID of user recording the expense
   * @returns Created journal entry
   */
  static async createExpenseGLEntry(
    tx: Prisma.TransactionClient,
    expenseId: number,
    amount: Money.MoneyInput,
    description: string,
    userId: number
  ): Promise<JournalEntryWithTransactions> {
    // Idempotency guard — prevent duplicate GL entries for the same expense
    const existingEntry = await tx.journalEntry.findFirst({
      where: {
        sourceType: JournalSourceType.expense,
        sourceId: expenseId,
        isVoided: false
      },
      include: { transactions: { include: { account: true } } }
    });
    if (existingEntry) {
      logger.warn(`Skipping duplicate GL entry for expense ${expenseId}: ${existingEntry.entryNumber} already exists`);
      return existingEntry as JournalEntryWithTransactions;
    }

    const expenseAmount = Money.parse(amount);

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.OPERATING_EXPENSE, tx),
        debitAmount: expenseAmount,
        creditAmount: Money.ZERO,
        description: `Expense recorded: ${description}`,
      },
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_HAND, tx),
        debitAmount: Money.ZERO,
        creditAmount: expenseAmount,
        description: `Cash reduction for expense: ${description}`,
      },
    ];

    return await this.createJournalEntryWithRetry(tx, {
      entryDate: new Date(),
      description: `Expense - ${description}`,
      sourceType: JournalSourceType.expense,
      sourceId: expenseId,
      createdBy: userId,
      transactions: {
        create: transactions,
      },
    });
  }

  /**
   * Create GL entry for COD deposit (when admin marks transactions as deposited)
   *
   * DR: Cash in Hand (1010)    = total deposit amount
   * CR: Cash in Transit (1015) = total deposit amount
   *
   * @param tx - Prisma transaction client
   * @param amount - Total deposit amount
   * @param sourceId - Source record ID (first transaction ID in the batch)
   * @param userId - ID of user processing the deposit
   * @returns Created journal entry
   */
  static async createDepositGLEntry(
    tx: Prisma.TransactionClient,
    amount: Money.MoneyInput,
    sourceId: number,
    userId: number
  ): Promise<JournalEntryWithTransactions> {
    // Idempotency guard — prevent duplicate GL entries for the same deposit
    const existingEntry = await tx.journalEntry.findFirst({
      where: {
        sourceType: JournalSourceType.agent_deposit,
        sourceId,
        isVoided: false
      },
      include: { transactions: { include: { account: true } } }
    });
    if (existingEntry) {
      logger.warn(`Skipping duplicate GL entry for deposit ${sourceId}: ${existingEntry.entryNumber} already exists`);
      return existingEntry as JournalEntryWithTransactions;
    }

    const depositAmount = Money.parse(amount);

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_HAND, tx),
        debitAmount: depositAmount,
        creditAmount: Money.ZERO,
        description: 'Cash in hand from COD deposit',
      },
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_TRANSIT, tx),
        debitAmount: Money.ZERO,
        creditAmount: depositAmount,
        description: 'Cash in transit cleared on deposit',
      },
    ];

    return await this.createJournalEntryWithRetry(tx, {
      entryDate: new Date(),
      description: `COD deposit recorded`,
      sourceType: JournalSourceType.agent_deposit,
      sourceId,
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
    // Idempotency guard — prevent duplicate GL entries for the same agent deposit
    const existingEntry = await tx.journalEntry.findFirst({
      where: {
        sourceType: JournalSourceType.agent_deposit,
        sourceId: deposit.id,
        isVoided: false
      },
      include: { transactions: { include: { account: true } } }
    });
    if (existingEntry) {
      logger.warn(`Skipping duplicate GL entry for agent deposit ${deposit.id}: ${existingEntry.entryNumber} already exists`);
      return existingEntry as JournalEntryWithTransactions;
    }

    const depositAmount = Money.parse(deposit.amount);

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_HAND, tx),
        debitAmount: depositAmount,
        creditAmount: Money.ZERO,
        description: `Deposit verification - Agent #${deposit.agentId} (Ref: ${deposit.referenceNumber})`,
      },
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.AR_AGENTS, tx),
        debitAmount: Money.ZERO,
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
   * Create GL entry for commission payout to a sales rep
   *
   * Records payment of accrued commission liability:
   * - Debit: Commissions Payable (reduces liability)
   * - Credit: Cash in Hand (cash leaves the business)
   *
   * @param tx - Prisma transaction client
   * @param payoutId - ID of the payout record
   * @param repId - ID of the sales rep being paid
   * @param amount - Payout amount
   * @param userId - ID of user processing the payout
   * @returns Created journal entry
   */
  static async recordCommissionPayout(
    tx: Prisma.TransactionClient,
    payoutId: number,
    repId: number,
    amount: Decimal,
    userId: number
  ): Promise<JournalEntryWithTransactions> {
    // Idempotency guard — prevent duplicate GL entries for the same payout
    const existingEntry = await tx.journalEntry.findFirst({
      where: {
        sourceType: JournalSourceType.payout,
        sourceId: payoutId,
        isVoided: false
      },
      include: { transactions: { include: { account: true } } }
    });
    if (existingEntry) {
      logger.warn(`Skipping duplicate GL entry for payout ${payoutId}: ${existingEntry.entryNumber} already exists`);
      return existingEntry as JournalEntryWithTransactions;
    }

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.COMMISSIONS_PAYABLE, tx),
        debitAmount: amount,
        creditAmount: Money.ZERO,
        description: `Commission payout to Rep #${repId}`,
      },
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_HAND, tx),
        debitAmount: Money.ZERO,
        creditAmount: amount,
        description: `Cash disbursed for commission payout to Rep #${repId}`,
      },
    ];

    return await this.createJournalEntryWithRetry(tx, {
      entryDate: new Date(),
      description: `Commission payout - Rep #${repId} (Payout #${payoutId})`,
      sourceType: JournalSourceType.payout,
      sourceId: payoutId,
      createdBy: userId,
      transactions: {
        create: transactions,
      },
    });
  }

  /**
   * Void a journal entry by creating a reversing entry and marking the original as voided.
   * Used when updating or deleting expenses to maintain GL integrity.
   *
   * @param tx - Prisma transaction client
   * @param sourceType - The source type of the journal entry (e.g., 'expense')
   * @param sourceId - The source record ID
   * @param userId - ID of user performing the void
   * @returns The reversing journal entry, or null if no entry found to void
   */
  static async voidJournalEntry(
    tx: Prisma.TransactionClient,
    sourceType: string,
    sourceId: number,
    userId: number
  ): Promise<JournalEntryWithTransactions | null> {
    // Find the original non-voided journal entry
    const originalEntry = await tx.journalEntry.findFirst({
      where: {
        sourceType: sourceType as JournalSourceType,
        sourceId,
        isVoided: false
      },
      include: {
        transactions: {
          include: {
            account: true
          }
        }
      }
    });

    if (!originalEntry) {
      logger.warn(`No active journal entry found to void for ${sourceType} #${sourceId}`);
      return null;
    }

    // Create reversing transactions (flip debits and credits)
    const reversingTransactions: TransactionCreateData[] = originalEntry.transactions.map(txn => ({
      accountId: txn.accountId,
      debitAmount: txn.creditAmount as unknown as Decimal,
      creditAmount: txn.debitAmount as unknown as Decimal,
      description: `Void: ${txn.description}`,
    }));

    // Create the reversing journal entry (marked as voided so idempotency guards
    // and future void calls don't pick it up as an active entry)
    const reversingEntry = await this.createJournalEntryWithRetry(tx, {
      entryDate: new Date(),
      description: `Void - ${originalEntry.description}`,
      sourceType: JournalSourceType.reversal,
      sourceId,
      createdBy: userId,
      transactions: {
        create: reversingTransactions,
      },
    });

    // Mark both original and reversing entries as voided
    await tx.journalEntry.updateMany({
      where: { id: { in: [originalEntry.id, reversingEntry.id] } },
      data: { isVoided: true, externalRef: null }
    });

    logger.info(`Voided journal entry ${originalEntry.entryNumber} for ${sourceType} #${sourceId}`);

    return reversingEntry;
  }

  /**
   * Create GL entry for inventory purchase (when a shipment arrives at warehouse)
   *
   * DR: Inventory (1200)       = totalCost
   * CR: Cash in Hand (1010)    = totalCost
   *
   * @param tx - Prisma transaction client
   * @param shipment - The inventory shipment record
   * @param userId - ID of user marking arrival
   * @returns Created journal entry
   */
  static async createInventoryPurchaseEntry(
    tx: Prisma.TransactionClient,
    shipment: InventoryShipment & { product: Product },
    userId: number
  ): Promise<JournalEntryWithTransactions> {
    // Idempotency guard — prevent duplicate GL entries for the same shipment
    const existingEntry = await tx.journalEntry.findFirst({
      where: {
        sourceType: JournalSourceType.inventory_purchase,
        sourceId: shipment.id,
        isVoided: false
      },
      include: { transactions: { include: { account: true } } }
    });
    if (existingEntry) {
      logger.warn(`Skipping duplicate GL entry for shipment ${shipment.id}: ${existingEntry.entryNumber} already exists`);
      return existingEntry as JournalEntryWithTransactions;
    }

    const totalCost = Money.parse(shipment.totalCost);

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.INVENTORY, tx),
        debitAmount: totalCost,
        creditAmount: Money.ZERO,
        description: `Inventory purchase - ${shipment.product.name} (${shipment.quantity} units)`,
      },
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_HAND, tx),
        debitAmount: Money.ZERO,
        creditAmount: totalCost,
        description: `Payment for inventory - ${shipment.supplier || 'Unknown supplier'}`,
      },
    ];

    return await this.createJournalEntryWithRetry(tx, {
      entryDate: new Date(),
      description: `Inventory purchase - ${shipment.product.name} x${shipment.quantity} from ${shipment.supplier || 'Unknown'}`,
      sourceType: JournalSourceType.inventory_purchase,
      sourceId: shipment.id,
      createdBy: userId,
      transactions: {
        create: transactions,
      },
    });
  }

  /**
   * Create GL entry for a digital product sale.
   * Revenue is recognized immediately on payment (not on delivery like physical).
   *
   * Journal entries:
   *   DR  Paystack Receivable (1030)    totalAmount
   *   CR  Digital Revenue (4020)         totalAmount
   *
   *   DR  Paystack Fees (5060)          paystackFee
   *   CR  Paystack Receivable (1030)    paystackFee
   */
  async createDigitalSaleEntry(
    tx: Prisma.TransactionClient,
    orderId: number,
    totalAmount: Money.MoneyInput,
    paystackFee: Money.MoneyInput,
    userId: number,
    entryDate: Date = new Date(),
  ): Promise<JournalEntry> {
    const paystackReceivableId = await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.PAYSTACK_RECEIVABLE);
    const digitalRevenueId = await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.DIGITAL_REVENUE);

    const totalAmountDec = new Decimal(totalAmount);
    const transactions: TransactionCreateData[] = [
      {
        accountId: paystackReceivableId,
        debitAmount: totalAmountDec,
        creditAmount: Money.ZERO,
        description: `Paystack payment received for digital order #${orderId}`,
      },
      {
        accountId: digitalRevenueId,
        debitAmount: Money.ZERO,
        creditAmount: totalAmountDec,
        description: `Digital product revenue - order #${orderId}`,
      },
    ];

    // Add Paystack fee entries if fee > 0
    const feeDec = new Decimal(paystackFee);
    if (feeDec.gt(0)) {
      const paystackFeesId = await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.PAYSTACK_FEES);
      transactions.push(
        {
          accountId: paystackFeesId,
          debitAmount: feeDec,
          creditAmount: Money.ZERO,
          description: `Paystack fee for order #${orderId}`,
        },
        {
          accountId: paystackReceivableId,
          debitAmount: Money.ZERO,
          creditAmount: feeDec,
          description: `Paystack fee deduction - order #${orderId}`,
        },
      );
    }

    return await GLAutomationService.createJournalEntryWithRetry(tx, {
      entryDate,
      description: `Digital product sale - order #${orderId}`,
      sourceType: JournalSourceType.digital_sale,
      sourceId: orderId,
      createdBy: userId,
      transactions: {
        create: transactions,
      },
    });
  }

  /**
   * Paystack pays out to the bank (F-934). Clears the Paystack receivable:
   *   DR  Cash in Hand (1010)           amount
   *   CR  Paystack Receivable (1030)    amount
   */
  async createPaystackPayoutEntry(
    tx: Prisma.TransactionClient,
    amount: Money.MoneyInput,
    entryDate: Date,
    description: string,
    userId: number,
    externalRef: string,
  ): Promise<JournalEntry> {
    const cashId = await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_HAND);
    const paystackReceivableId = await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.PAYSTACK_RECEIVABLE);
    const amountDec = new Decimal(amount);

    return await GLAutomationService.createJournalEntryWithRetry(tx, {
      entryDate,
      description,
      sourceType: JournalSourceType.paystack_payout,
      externalRef,
      createdBy: userId,
      transactions: {
        create: [
          { accountId: cashId, debitAmount: amountDec, creditAmount: Money.ZERO, description: 'Paystack payout received in bank' },
          { accountId: paystackReceivableId, debitAmount: Money.ZERO, creditAmount: amountDec, description: 'Paystack payout clears receivable' },
        ],
      },
    });
  }
}
