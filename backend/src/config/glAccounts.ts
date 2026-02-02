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

export const GL_ACCOUNTS = {
  // Asset Accounts (1000-1999)
  CASH_IN_TRANSIT: '1015',           // Cash from delivered orders (with delivery agents)
  CASH_IN_HAND: '1010',              // Cash collected by agents (not yet deposited)
  AR_AGENTS: '1020',                 // Accounts Receivable - Delivery Agents
  INVENTORY: '1200',                 // Product inventory value

  // Revenue Accounts (4000-4999)
  PRODUCT_REVENUE: '4010',           // Sales revenue from products

  // Expense Accounts (5000-5999)
  COGS: '5010',                      // Cost of goods sold
  FAILED_DELIVERY_EXPENSE: '5020',   // Delivery failure operational costs
  RETURN_PROCESSING_EXPENSE: '5030', // Return handling costs
  DELIVERY_AGENT_COMMISSION: '5040', // Delivery agent commission expense
  SALES_REP_COMMISSION: '5050',      // Sales representative commission expense

  // Liability Accounts (2000-2999)
  REFUND_LIABILITY: '2010',          // Customer refunds pending payment
  COMMISSIONS_PAYABLE: '2020',       // Unpaid agent and rep commissions
} as const;

export const GL_DEFAULTS = {
  /**
   * Default fee for failed deliveries when delivery.deliveryFee is not set
   */
  FAILED_DELIVERY_FEE: 50.00,

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
