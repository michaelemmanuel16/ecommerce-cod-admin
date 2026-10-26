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

import { Prisma, Order, OrderItem, Product, Customer, User, JournalEntry, AccountTransaction, JournalSourceType, AgentDeposit, InventoryShipment, FeeOutcome } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { BALANCE_TOLERANCE, GL_ACCOUNTS, GL_DEFAULTS, RETIRED_EXPENSE_CODES } from '../config/glAccounts';
import { GLAccountService } from './glAccountService';
import logger from '../utils/logger';
import { GLUtils } from '../utils/glUtils';
import { openFindingOnce } from './findingService';
import { getTenantId, resolveTenantId } from '../utils/tenantContext';
import type { TransactionClient } from '../utils/prisma';
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
  static calculateTotalCOGS(orderItems: Array<{ quantity: number; product: { cogs: Decimal | null } }>): Decimal {
    return Money.sum(orderItems.map((item) => Money.mul(Money.orZero(item.product.cogs), item.quantity)));
  }

  /**
   * The COGS of an order being delivered: the landed cost booked on the order when it entered delivered (F-611), else the
   * items at the product cost now (orders delivered before M4, and an order with no physical line).
   */
  static cogsOfOrder(order: { landedCostTotal?: Decimal | null; orderItems: OrderItemWithProduct[] }): Decimal {
    return order.landedCostTotal != null ? Money.parse(order.landedCostTotal) : this.calculateTotalCOGS(order.orderItems);
  }

  /**
   * The COGS leg of an entry, read from its lines: what the entry booked, not what the product costs today.
   * Null when the lines were not loaded.
   */
  static cogsBooked(entry: JournalEntryWithTransactions | undefined | null): Decimal | null {
    if (!entry?.transactions) return null;
    return Money.sum(entry.transactions.filter((t) => t.account?.code === GL_ACCOUNTS.COGS).map((t) => t.debitAmount));
  }

  /**
   * Agent commission an entry booked before M5: the debit on the retired commission expense account (lines must carry
   * their account). Entries booked from M5 on have none, so this is 0 for them.
   */
  static legacyAgentCommission(entry: JournalEntryWithTransactions | undefined | null): Decimal {
    if (!entry?.transactions) return Money.ZERO;
    return Money.sum(
      entry.transactions
        .filter((t) => t.account && t.account.code !== undefined && RETIRED_EXPENSE_CODES.includes(t.account.code))
        .map((t) => Money.sub(t.debitAmount, t.creditAmount)),
    );
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
   * - Debit: Cash in Transit 1015 (the full order amount; the delivery fee is a separate entry, F-936)
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

    const salesRep = order.customerRep;
    const salesRepCommission = Money.orZero(salesRep?.commissionAmount);

    // Build journal entry transactions
    // Cash in Transit = the gross amount the partner collected. The partner keeps its delivery fee from that cash;
    // the fee posts as its own entry (DR 5070, CR 1015), so 1015 ends at gross minus fee.
    // Commissions Payable = Sales Rep Commission (since they don't hold the cash)
    const repComm = salesRepCommission;

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_TRANSIT),
        debitAmount: orderAmount,
        creditAmount: Money.ZERO,
        description: `Collection held by partner for order ${order.id} (Gross ${orderAmount})`,
      },
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.PRODUCT_REVENUE),
        debitAmount: Money.ZERO,
        creditAmount: orderAmount,
        description: 'Product sales revenue (Gross)',
      },
    ];

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
   * Delivery fee entry, one per outcome move (F-936, F-935): DR 5070 / CR 1015 for the fee stamped on the order.
   * The partner keeps the fee from the cash it holds, so 1015 goes down by the fee and nothing is paid out.
   * Keyed on `<outcome>:<OrderHistory id>` in `externalRef` with the order as source, so a repeat of the same
   * move posts nothing and a second failed attempt posts a second fee. A fee of 0 posts nothing.
   * Dated by the outcome (delivery date, close date or return date).
   */
  static async createDeliveryFeeEntry(
    tx: Prisma.TransactionClient,
    order: { id: number; tenantId?: string | null },
    outcome: FeeOutcome,
    fee: Money.MoneyInput,
    historyId: number,
    userId: number,
    entryDate: Date = new Date()
  ): Promise<JournalEntryWithTransactions | null> {
    const amount = Money.parse(fee);
    if (!amount.greaterThan(0)) return null;

    const externalRef = `${outcome}:${historyId}`;
    const existingEntry = await tx.journalEntry.findFirst({
      where: { sourceType: JournalSourceType.delivery_fee, externalRef, isVoided: false },
      include: { transactions: { include: { account: true } } }
    });
    if (existingEntry) return existingEntry as JournalEntryWithTransactions;

    const [expenseAccountId, cashAccountId] = await Promise.all([
      GLAccountService.getAccountIdByCode(GL_ACCOUNTS.DELIVERY_FEES),
      GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_TRANSIT),
    ]);
    return await this.createJournalEntryWithRetry(tx, {
      entryDate,
      description: `Delivery fee (${outcome}) - Order #${order.id}`,
      sourceType: JournalSourceType.delivery_fee,
      sourceId: order.id,
      externalRef,
      createdBy: userId,
      tenantId: order.tenantId ?? undefined,
      transactions: {
        create: [
          {
            accountId: expenseAccountId,
            debitAmount: amount,
            creditAmount: Money.ZERO,
            description: `Delivery fee kept by partner (${outcome}) - Order #${order.id}`,
          },
          {
            accountId: cashAccountId,
            debitAmount: Money.ZERO,
            creditAmount: amount,
            description: 'Fee netted from the cash the partner holds',
          },
        ],
      },
    });
  }

  /**
   * Fee true-up of one settlement (F-906, F-936): the partner's real charges replace the fees booked at delivery.
   * `net` is the sum over the settlement's lines of (charge - fee booked). Above 0: DR 5070 / CR 1015. Below 0 the
   * entry is flipped. One entry per settlement, keyed `trueup:<settlementId>`, so a repeat posts nothing. 0 posts nothing.
   */
  static async createFeeTrueUpEntry(
    tx: Prisma.TransactionClient,
    settlement: { id: number; reference: string; tenantId?: string | null },
    net: Money.MoneyInput,
    userId: number,
    entryDate: Date = new Date()
  ): Promise<JournalEntryWithTransactions | null> {
    const amount = Money.parse(net);
    if (amount.isZero()) return null;

    const externalRef = `trueup:${settlement.id}`;
    const existingEntry = await tx.journalEntry.findFirst({
      where: { sourceType: JournalSourceType.delivery_fee, externalRef, isVoided: false },
      include: { transactions: { include: { account: true } } }
    });
    if (existingEntry) return existingEntry as JournalEntryWithTransactions;

    const [expenseAccountId, cashAccountId] = await Promise.all([
      GLAccountService.getAccountIdByCode(GL_ACCOUNTS.DELIVERY_FEES, tx),
      GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_TRANSIT, tx),
    ]);
    const size = amount.abs();
    const more = amount.gt(0);
    return await this.createJournalEntryWithRetry(tx, {
      entryDate,
      description: `Delivery fee true-up - settlement ${settlement.reference}`,
      sourceType: JournalSourceType.delivery_fee,
      sourceId: settlement.id,
      externalRef,
      createdBy: userId,
      tenantId: settlement.tenantId ?? undefined,
      transactions: {
        create: [
          {
            accountId: expenseAccountId,
            debitAmount: more ? size : Money.ZERO,
            creditAmount: more ? Money.ZERO : size,
            description: `Partner charge ${more ? 'above' : 'below'} the fee booked (settlement ${settlement.reference})`,
          },
          {
            accountId: cashAccountId,
            debitAmount: more ? Money.ZERO : size,
            creditAmount: more ? size : Money.ZERO,
            description: 'Fee true-up netted from the cash the partner holds',
          },
        ],
      },
    });
  }

  /**
   * Write-off of a Finding (F-909). `account` 1015 (cash a partner was to hand in): DR 5100 / CR 1015, an expense.
   * `account` 2040 (extra money we hold): DR 2040 / CR 5100, the liability is released against operating expense.
   * (The PRD text "DR 5100 and CR 1015 or 2040" is corrected here for the 2040 types.) Keyed `finding-writeoff:<id>` with its own source type, so a repeat posts
   * nothing and a manual journal void cannot reach it. An amount of 0 posts nothing.
   */
  static async createFindingWriteOffEntry(
    tx: Prisma.TransactionClient,
    finding: { id: number; type: string; tenantId?: string | null },
    amount: Money.MoneyInput,
    account: typeof GL_ACCOUNTS.CASH_IN_TRANSIT | typeof GL_ACCOUNTS.UNAPPLIED_PARTNER_RECEIPTS,
    userId: number,
    note: string
  ): Promise<JournalEntryWithTransactions | null> {
    const size = Money.parse(amount);
    if (!size.greaterThan(0)) return null;

    const externalRef = `finding-writeoff:${finding.id}`;
    const existingEntry = await tx.journalEntry.findFirst({
      where: { sourceType: JournalSourceType.finding_writeoff, externalRef, isVoided: false },
      include: { transactions: { include: { account: true } } }
    });
    if (existingEntry) return existingEntry as JournalEntryWithTransactions;

    const [expenseAccountId, otherAccountId] = await Promise.all([
      GLAccountService.getAccountIdByCode(GL_ACCOUNTS.OPERATING_EXPENSE, tx),
      GLAccountService.getAccountIdByCode(account, tx),
    ]);
    const expenseDebit = account === GL_ACCOUNTS.CASH_IN_TRANSIT;
    return await this.createJournalEntryWithRetry(tx, {
      entryDate: new Date(),
      description: `Write-off of finding #${finding.id} (${finding.type}): ${note}`,
      sourceType: JournalSourceType.finding_writeoff,
      sourceId: finding.id,
      externalRef,
      createdBy: userId,
      tenantId: finding.tenantId ?? undefined,
      transactions: {
        create: [
          { accountId: expenseAccountId, debitAmount: expenseDebit ? size : Money.ZERO, creditAmount: expenseDebit ? Money.ZERO : size, description: `Written-off ${finding.type.replace(/_/g, ' ')}` },
          { accountId: otherAccountId, debitAmount: expenseDebit ? Money.ZERO : size, creditAmount: expenseDebit ? size : Money.ZERO, description: `Finding #${finding.id} written off` },
        ],
      },
    });
  }

  /**
   * Reverses the order's delivered fee entry when the order leaves `delivered`, like the revenue reversal (D7):
   * the original is linked to its reversal through `reversingEntryId`, so the order has no active delivered fee
   * afterwards and a later delivery posts a fresh one. Returns null when the order has none (fee 0, or booked before M5).
   */
  static async reverseDeliveredFee(
    tx: Prisma.TransactionClient,
    order: { id: number; tenantId?: string | null },
    userId: number,
    entryDate: Date = new Date()
  ): Promise<JournalEntryWithTransactions | null> {
    const original = await tx.journalEntry.findFirst({
      where: {
        sourceType: JournalSourceType.delivery_fee, sourceId: order.id, externalRef: { startsWith: 'delivered:' },
        isVoided: false, reversingEntryId: null,
      },
      include: { transactions: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!original) return null;

    const reversal = await this.createJournalEntryWithRetry(tx, {
      entryDate,
      description: `Delivery fee reversal - Order #${order.id} (Original JE: ${original.entryNumber})`,
      sourceType: JournalSourceType.delivery_fee,
      sourceId: order.id,
      externalRef: `reversal:${original.id}`,
      createdBy: userId,
      tenantId: order.tenantId ?? undefined,
      transactions: {
        create: this.flippedLines(original.transactions, 'Reversal'),
      },
    });
    await tx.journalEntry.update({ where: { id: original.id }, data: { reversingEntryId: reversal.id } });
    return reversal;
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

    const salesRep = order.customerRep;
    const salesRepCommission = Money.orZero(salesRep?.commissionAmount);

    // COGS to reverse: the amount the original entry booked (F-611), so a later cost change never makes the ledger uneven.
    const totalCOGS = this.cogsBooked(originalEntry) ?? this.calculateTotalCOGS(order.orderItems);

    // An entry booked before M5 netted the agent commission against cash in transit and booked it to the retired
    // commission expense account. Reverse exactly that amount, and credit it to 5070 (delivery fees): nothing posts to a retired account.
    const agentComm = this.legacyAgentCommission(originalEntry);
    const repComm = salesRepCommission;
    const netCashInTransit = orderAmount.minus(agentComm);

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_TRANSIT),
        debitAmount: Money.ZERO,
        creditAmount: netCashInTransit,
        description: 'Cash in transit reversal',
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
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.DELIVERY_FEES),
        debitAmount: Money.ZERO,
        creditAmount: agentComm,
        description: 'Delivery fee reversal (booked as agent commission before M5)',
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
   * GL entry for a verified agent deposit (F-904). The only place cash moves from the partner to the bank:
   * - Debit: Cash at bank and MoMo 1010 (the amount received, which is cash collected minus the fees the partner kept)
   * - Credit: Cash in Transit 1015 (`cover.matched`: the part that matched the partner's open collections, FIFO)
   * - Credit: Unapplied Partner Receipts 2040 (`cover.remaining`: any excess), with an `excess_deposit` Finding
   * The caller matches the collections first and passes the result in.
   * Verifying a single collection posts nothing; 1015 already holds the net amount from the delivery.
   * Idempotent per deposit.
   *
   * @param tx - Prisma transaction client
   * @param deposit - Agent deposit record
   * @param userId - ID of user verifying the deposit
   * @param cover - What the FIFO match covered (`matched`) and what is left over (`remaining`)
   * @returns Created journal entry
   */
  static async createAgentDepositEntry(
    tx: Prisma.TransactionClient,
    deposit: AgentDeposit,
    userId: number,
    cover: { matched: Money.MoneyInput; remaining: Money.MoneyInput }
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
    const matched = Money.parse(cover.matched);
    const excess = Money.parse(cover.remaining);

    const transactions: TransactionCreateData[] = [
      {
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_HAND, tx),
        debitAmount: depositAmount,
        creditAmount: Money.ZERO,
        description: `Deposit verification - Agent #${deposit.agentId} (Ref: ${deposit.referenceNumber})`,
      },
    ];
    if (matched.greaterThan(0)) {
      transactions.push({
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.CASH_IN_TRANSIT, tx),
        debitAmount: Money.ZERO,
        creditAmount: matched,
        description: `Deposit matching - Agent #${deposit.agentId}`,
      });
    }
    if (excess.greaterThan(0)) {
      transactions.push({
        accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.UNAPPLIED_PARTNER_RECEIPTS, tx),
        debitAmount: Money.ZERO,
        creditAmount: excess,
        description: `Deposit above open collections - Agent #${deposit.agentId} (Ref: ${deposit.referenceNumber})`,
      });
    }

    const entry = await this.createJournalEntryWithRetry(tx, {
      entryDate: deposit.depositDate ?? new Date(),
      description: `Agent deposit verification - Ref #${deposit.referenceNumber}`,
      sourceType: JournalSourceType.agent_deposit,
      sourceId: deposit.id,
      createdBy: userId,
      tenantId: deposit.tenantId ?? undefined,
      transactions: {
        create: transactions,
      },
    });

    if (excess.greaterThan(0)) {
      await openFindingOnce({
        tenantId: resolveTenantId(deposit.tenantId),
        type: 'excess_deposit',
        subjectType: 'agent_deposit',
        subjectId: String(deposit.id),
        amount: excess,
        note: `Deposit ${deposit.referenceNumber} is ${Money.toApi(excess)} more than the partner's open collections. The excess is held in 2040.`,
      }, { includeClosed: true }, tx as any);
    }
    return entry;
  }

  /**
   * The two legs of a commission entry: earned = DR 5050 / CR 2020, reversed = DR 2020 / CR 5050.
   * Takes the app's extended transaction client, the one the services hold; the single cast to the base
   * client is here, so callers need none.
   */
  private static async postCommissionLegs(
    tx: TransactionClient,
    entry: { id: number; tenantId: string; orderId: number | null; amount: Decimal },
    userId: number,
    entryDate: Date,
    kind: 'earned' | 'reversed',
  ): Promise<JournalEntryWithTransactions> {
    const base = tx as unknown as Prisma.TransactionClient;
    const earned = kind === 'earned';
    const amount = Money.parse(entry.amount);
    const label = entry.orderId ? `Order #${entry.orderId}` : `Entry #${entry.id}`;
    const expense = { accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.SALES_REP_COMMISSION, base) };
    const payable = { accountId: await GLAccountService.getAccountIdByCode(GL_ACCOUNTS.COMMISSIONS_PAYABLE, base) };
    return await this.createJournalEntryWithRetry(base, {
      entryDate,
      description: `${earned ? 'Commission earned' : 'Commission reversal'} - ${label}`,
      sourceType: JournalSourceType.commission_accrual,
      sourceId: entry.id,
      externalRef: earned ? `commission-entry:${entry.id}` : `commission-entry-void:${entry.id}`,
      createdBy: userId,
      tenantId: entry.tenantId,
      transactions: {
        create: earned
          ? [
              { ...expense, debitAmount: amount, creditAmount: Money.ZERO, description: 'Sales representative commission expense' },
              { ...payable, debitAmount: Money.ZERO, creditAmount: amount, description: 'Accrued commissions payable to sales rep' },
            ]
          : [
              { ...payable, debitAmount: amount, creditAmount: Money.ZERO, description: 'Accrued commissions payable reversal' },
              { ...expense, debitAmount: Money.ZERO, creditAmount: amount, description: 'Sales representative commission reversal' },
            ],
      },
    });
  }

  /**
   * Commission earned (F-914, M5-T18): DR 5050 Sales rep commission, CR 2020 Commissions payable for one
   * `CommissionEntry`. Source is the entry (`commission_accrual` + entry id), and the external ref `commission-entry:<id>`
   * is unique per tenant, so a repeat can never post twice (the caller also locks the entry row).
   */
  static async recordCommissionAccrual(
    tx: TransactionClient,
    entry: { id: number; tenantId: string; orderId: number | null; amount: Decimal },
    userId: number,
    entryDate: Date = new Date()
  ): Promise<JournalEntryWithTransactions> {
    return this.postCommissionLegs(tx, entry, userId, entryDate, 'earned');
  }

  /**
   * Reversal of `recordCommissionAccrual` when a returned order voids its entry: DR 2020, CR 5050 for the
   * entry's amount (a split remainder reverses only what it still holds). External ref
   * `commission-entry-void:<id>` makes a repeat a no-op.
   */
  static async reverseCommissionAccrual(
    tx: TransactionClient,
    entry: { id: number; tenantId: string; orderId: number | null; amount: Decimal },
    userId: number,
    entryDate: Date = new Date()
  ): Promise<JournalEntryWithTransactions> {
    const existing = await tx.journalEntry.findFirst({
      where: { tenantId: entry.tenantId, sourceType: JournalSourceType.commission_accrual, externalRef: `commission-entry-void:${entry.id}` },
      include: { transactions: { include: { account: true } } },
    });
    if (existing) return existing as JournalEntryWithTransactions;
    return this.postCommissionLegs(tx, entry, userId, entryDate, 'reversed');
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
    userId: number,
    opts: { entryDate?: Date; tenantId?: string } = {}
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
      entryDate: opts.entryDate ?? new Date(),
      description: `Commission payout - Rep #${repId} (Payout #${payoutId})`,
      sourceType: JournalSourceType.payout,
      sourceId: payoutId,
      createdBy: userId,
      tenantId: opts.tenantId,
      transactions: {
        create: transactions,
      },
    });
  }

  /** The lines of an entry with debit and credit swapped, each description prefixed. */
  private static flippedLines(
    transactions: Array<{ accountId: number; debitAmount: Decimal | Prisma.Decimal; creditAmount: Decimal | Prisma.Decimal; description: string | null }>,
    prefix: string
  ): TransactionCreateData[] {
    return transactions.map((t) => ({
      accountId: t.accountId,
      debitAmount: t.creditAmount as unknown as Decimal,
      creditAmount: t.debitAmount as unknown as Decimal,
      description: `${prefix}: ${t.description ?? ''}`,
    }));
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
    const reversingTransactions = this.flippedLines(originalEntry.transactions, 'Void');

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
   * One two-line inventory entry for a shipment: DR `debitCode` / CR `creditCode` for `amount`. The shipment is the source
   * (`sourceType` + `sourceId`), so a repeat returns the entry already posted (idempotent).
   */
  private static async postInventoryEntry(
    tx: Prisma.TransactionClient,
    shipment: Pick<InventoryShipment, 'id' | 'tenantId'>,
    o: {
      sourceType: JournalSourceType; debitCode: string; creditCode: string; amount: Money.MoneyInput; entryDate: Date; userId: number;
      description: string; debitDescription: string; creditDescription: string;
    }
  ): Promise<JournalEntryWithTransactions> {
    const existingEntry = await tx.journalEntry.findFirst({
      where: { sourceType: o.sourceType, sourceId: shipment.id, isVoided: false },
      include: { transactions: { include: { account: true } } }
    });
    if (existingEntry) {
      logger.warn(`Skipping duplicate GL entry for shipment ${shipment.id}: ${existingEntry.entryNumber} already exists`);
      return existingEntry as JournalEntryWithTransactions;
    }

    const amount = Money.parse(o.amount);
    return await this.createJournalEntryWithRetry(tx, {
      entryDate: o.entryDate,
      description: o.description,
      sourceType: o.sourceType,
      sourceId: shipment.id,
      createdBy: o.userId,
      tenantId: shipment.tenantId ?? undefined,
      transactions: {
        create: [
          { accountId: await GLAccountService.getAccountIdByCode(o.debitCode, tx), debitAmount: amount, creditAmount: Money.ZERO, description: o.debitDescription },
          { accountId: await GLAccountService.getAccountIdByCode(o.creditCode, tx), debitAmount: Money.ZERO, creditAmount: amount, description: o.creditDescription },
        ],
      },
    });
  }

  /**
   * Inventory purchase entry, posted once when a shipment is received (M4-T12, F-606).
   *
   * DR: Inventory (1200)       = total in store currency (the full shipment total, not only the counted units)
   * CR: Cash in Hand (1010)    = the same
   *
   * Dated the received date.
   */
  static async createInventoryPurchaseEntry(
    tx: Prisma.TransactionClient,
    shipment: Pick<InventoryShipment, 'id' | 'tenantId' | 'supplier' | 'quantity'>,
    productName: string,
    totalStore: Money.MoneyInput,
    entryDate: Date,
    userId: number
  ): Promise<JournalEntryWithTransactions> {
    return this.postInventoryEntry(tx, shipment, {
      sourceType: JournalSourceType.inventory_purchase, debitCode: GL_ACCOUNTS.INVENTORY, creditCode: GL_ACCOUNTS.CASH_IN_HAND,
      amount: totalStore, entryDate, userId,
      description: `Inventory purchase - ${productName} x${shipment.quantity} from ${shipment.supplier || 'Unknown'}`,
      debitDescription: `Inventory purchase - ${productName} (${shipment.quantity} units shipped)`,
      creditDescription: `Payment for inventory - ${shipment.supplier || 'Unknown supplier'}`,
    });
  }

  /**
   * Supplier claim settled with money recovered (M4-T12, F-608): the cash comes back and the inventory value goes down.
   *
   * DR: Cash in Hand (1010)    = amount recovered
   * CR: Inventory (1200)       = amount recovered
   */
  static async createInventoryClaimEntry(
    tx: Prisma.TransactionClient,
    shipment: Pick<InventoryShipment, 'id' | 'tenantId' | 'supplier'>,
    productName: string,
    amountRecovered: Money.MoneyInput,
    userId: number
  ): Promise<JournalEntryWithTransactions> {
    return this.postInventoryEntry(tx, shipment, {
      sourceType: JournalSourceType.inventory_claim, debitCode: GL_ACCOUNTS.CASH_IN_HAND, creditCode: GL_ACCOUNTS.INVENTORY,
      amount: amountRecovered, entryDate: new Date(), userId,
      description: `Supplier claim recovered - ${productName} shipment #${shipment.id}`,
      debitDescription: `Supplier claim recovered - ${shipment.supplier || 'Unknown supplier'}`,
      creditDescription: `Short shipment recovered - ${productName}`,
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
