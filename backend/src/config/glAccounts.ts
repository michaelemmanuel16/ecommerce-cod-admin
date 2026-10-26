/**
 * General Ledger Account Mapping Configuration
 *
 * Defines account codes for automated GL entry creation in the order lifecycle.
 * These codes must match accounts in the Chart of Accounts database.
 *
 * Account Code Ranges:
 * - Assets: 1000-1999
 * - Liabilities: 2000-2999
 * - Equity: 3000-3999
 * - Revenue: 4000-4999
 * - Expenses: 5000-5999
 */

import { Prisma } from '@prisma/client';

export const GL_ACCOUNTS = {
  // Asset Accounts (1000-1999)
  CASH_IN_TRANSIT: '1015',           // Cash from delivered orders (with delivery agents)
  CASH_IN_HAND: '1010',              // Cash at bank and MoMo (the one cash account)
  AR_AGENTS: '1020',                 // Accounts Receivable - Delivery Agents (inactive since M5; cash held by partners is 1015)
  INVENTORY: '1200',                 // Product inventory value

  // Asset Accounts - Digital/Payment
  PAYSTACK_RECEIVABLE: '1030',       // Money in Paystack awaiting settlement

  // Revenue Accounts (4000-4999)
  PRODUCT_REVENUE: '4010',           // Sales revenue from products
  DIGITAL_REVENUE: '4020',           // Digital product sales revenue

  // Expense Accounts (5000-5999)
  COGS: '5010',                      // Cost of goods sold
  PAYSTACK_FEES: '5060',             // Payment gateway fees
  FAILED_DELIVERY_EXPENSE: '5020',   // Delivery failure operational costs
  RETURN_PROCESSING_EXPENSE: '5030', // Return handling costs
  DELIVERY_AGENT_COMMISSION: '5040', // Delivery agent commission expense (inactive since M5; delivery fees go to 5070)
  SALES_REP_COMMISSION: '5050',      // Sales representative commission expense
  OPERATING_EXPENSE: '5100',         // General operating expenses (non-COGS, non-commission)
  DELIVERY_FEES: '5070',             // Delivery fees kept by 3PLs and agents, all outcomes (M5)
  META_AD_SPEND: '5080',             // Meta ad spend (M5)

  // Liability Accounts (2000-2999)
  REFUND_LIABILITY: '2010',          // Customer refunds pending payment
  COMMISSIONS_PAYABLE: '2020',       // Unpaid agent and rep commissions
  UNAPPLIED_PARTNER_RECEIPTS: '2040', // Money from a partner that matches no order (M5)
  SUPPLIER_PAYABLES: '2050',         // Shipment amounts not yet paid to suppliers (M5)

  // Equity Accounts (3000-3999)
  OWNER_EQUITY: '3010',              // Owner's equity (M5)
} as const;

export const GL_DEFAULTS = {
  /**
   * Minimum COGS threshold to record in GL entries
   * If totalCOGS < this value, COGS/Inventory entries will be skipped
   */
  MIN_COGS_THRESHOLD: 0.01,

  /**
   * Default return processing fee (0 = requires manual entry per return)
   * Set to 0 to require manual specification since amounts vary per case
   */
  DEFAULT_RETURN_PROCESSING_FEE: 0,
} as const;

/** Largest debit/credit imbalance a journal entry may carry (rounding noise). */
export const BALANCE_TOLERANCE = new Prisma.Decimal('0.01');

/**
 * Validate that all GL account codes are configured
 * Should be called at application startup to ensure accounts exist
 *
 * @throws Error if any account codes are not set or appear to be placeholders
 */
export function validateGLAccountCodes(): void {
  const accounts = Object.entries(GL_ACCOUNTS);

  for (const [key, code] of accounts) {
    if (!code || code.startsWith('TBD')) {
      throw new Error(
        `GL account code for ${key} is not configured. ` +
        `Update backend/src/config/glAccounts.ts with actual account codes from Chart of Accounts.`
      );
    }

    // Validate code format (4-digit number)
    if (!/^\d{4}$/.test(code)) {
      throw new Error(
        `GL account code for ${key} must be a 4-digit number. Got: ${code}`
      );
    }
  }
}

/**
 * Get account code by key
 * Type-safe accessor for account codes
 */
export function getAccountCode(key: keyof typeof GL_ACCOUNTS): string {
  return GL_ACCOUNTS[key];
}

type DefaultGLAccount = {
  code: string;
  name: string;
  accountType: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  normalBalance: 'debit' | 'credit';
  /** Defaults to false. The accounts added in M5 are system accounts. */
  isSystem?: boolean;
  /** Defaults to true. Retired accounts (1020, 5040) stay in the chart for history and take no postings. */
  isActive?: boolean;
};

/**
 * The chart of accounts every tenant needs. One row per GL_ACCOUNTS code.
 * Created per tenant by seedTenantDefaults.
 */
export const DEFAULT_GL_ACCOUNTS: readonly DefaultGLAccount[] = [
  { code: GL_ACCOUNTS.CASH_IN_HAND, name: 'Cash at bank and MoMo', accountType: 'asset', normalBalance: 'debit' },
  { code: GL_ACCOUNTS.CASH_IN_TRANSIT, name: 'Cash in Transit', accountType: 'asset', normalBalance: 'debit' },
  { code: GL_ACCOUNTS.AR_AGENTS, name: 'Accounts Receivable - Agents', accountType: 'asset', normalBalance: 'debit', isActive: false },
  { code: GL_ACCOUNTS.INVENTORY, name: 'Inventory', accountType: 'asset', normalBalance: 'debit' },
  { code: GL_ACCOUNTS.PAYSTACK_RECEIVABLE, name: 'Paystack Receivable', accountType: 'asset', normalBalance: 'debit' },
  { code: GL_ACCOUNTS.PRODUCT_REVENUE, name: 'Product Sales Revenue', accountType: 'revenue', normalBalance: 'credit' },
  { code: GL_ACCOUNTS.DIGITAL_REVENUE, name: 'Digital Product Revenue', accountType: 'revenue', normalBalance: 'credit' },
  { code: GL_ACCOUNTS.COGS, name: 'Cost of Goods Sold', accountType: 'expense', normalBalance: 'debit' },
  { code: GL_ACCOUNTS.PAYSTACK_FEES, name: 'Paystack Transaction Fees', accountType: 'expense', normalBalance: 'debit' },
  { code: GL_ACCOUNTS.FAILED_DELIVERY_EXPENSE, name: 'Failed Delivery Expense', accountType: 'expense', normalBalance: 'debit' },
  { code: GL_ACCOUNTS.RETURN_PROCESSING_EXPENSE, name: 'Return Processing Expense', accountType: 'expense', normalBalance: 'debit' },
  { code: GL_ACCOUNTS.DELIVERY_AGENT_COMMISSION, name: 'Delivery Agent Commission', accountType: 'expense', normalBalance: 'debit', isActive: false },
  { code: GL_ACCOUNTS.SALES_REP_COMMISSION, name: 'Sales Rep Commission', accountType: 'expense', normalBalance: 'debit' },
  { code: GL_ACCOUNTS.COMMISSIONS_PAYABLE, name: 'Commissions Payable', accountType: 'liability', normalBalance: 'credit' },
  { code: GL_ACCOUNTS.REFUND_LIABILITY, name: 'Refund Liability', accountType: 'liability', normalBalance: 'credit' },
  { code: GL_ACCOUNTS.OPERATING_EXPENSE, name: 'Operating Expenses', accountType: 'expense', normalBalance: 'debit' },
  { code: GL_ACCOUNTS.UNAPPLIED_PARTNER_RECEIPTS, name: 'Unapplied Partner Receipts', accountType: 'liability', normalBalance: 'credit', isSystem: true },
  { code: GL_ACCOUNTS.SUPPLIER_PAYABLES, name: 'Supplier Payables', accountType: 'liability', normalBalance: 'credit', isSystem: true },
  { code: GL_ACCOUNTS.OWNER_EQUITY, name: "Owner's Equity", accountType: 'equity', normalBalance: 'credit', isSystem: true },
  { code: GL_ACCOUNTS.DELIVERY_FEES, name: 'Delivery Fees', accountType: 'expense', normalBalance: 'debit', isSystem: true },
  { code: GL_ACCOUNTS.META_AD_SPEND, name: 'Meta Ad Spend', accountType: 'expense', normalBalance: 'debit', isSystem: true },
];
