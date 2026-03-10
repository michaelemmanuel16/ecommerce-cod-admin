import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Prisma, AccountType, NormalBalance, JournalSourceType } from '@prisma/client';
import logger from '../utils/logger';
import { Requester } from '../utils/authUtils';

interface AccountFilters {
  accountType?: AccountType;
  isActive?: boolean;
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
}

interface CreateAccountData {
  code: string;
  name: string;
  description?: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  parentId?: number;
}

interface UpdateAccountData {
  name?: string;
  description?: string;
  parentId?: number | null;
}

interface JournalEntryTransaction {
  accountId: number;
  debitAmount: number | string;
  creditAmount: number | string;
  description?: string;
}

interface CreateJournalEntryData {
  entryDate: Date | string;
  description: string;
  sourceType: JournalSourceType;
  sourceId?: number;
  transactions: JournalEntryTransaction[];
}

interface JournalEntryFilters {
  sourceType?: JournalSourceType;
  sourceId?: number;
  isVoided?: boolean;
  startDate?: Date | string;
  endDate?: Date | string;
  page?: number;
  limit?: number;
}

interface AccountLedgerFilters {
  startDate?: Date | string;
  endDate?: Date | string;
  page?: number;
  limit?: number;
}

export class GLService {
  /**
   * Validate normal balance matches account type
   * Assets and expenses must have debit normal balance
   * Liabilities, equity, and revenue must have credit normal balance
   */
  private validateNormalBalance(accountType: AccountType, normalBalance: NormalBalance): void {
    const validationRules: Record<AccountType, NormalBalance> = {
      asset: NormalBalance.debit,
      expense: NormalBalance.debit,
      liability: NormalBalance.credit,
      equity: NormalBalance.credit,
      revenue: NormalBalance.credit
    };

    if (validationRules[accountType] !== normalBalance) {
      throw new AppError(
        `Invalid normal balance for ${accountType} account. Expected ${validationRules[accountType]}, got ${normalBalance}`,
        400,
        'GL_INVALID_NORMAL_BALANCE'
      );
    }
  }

  /**
   * Validate account code format and range
   * Account codes must be 4-digit numbers within the correct range for the account type
   */
  private validateAccountCode(code: string, accountType: AccountType): void {
    const codeNum = parseInt(code, 10);

    if (isNaN(codeNum) || code !== codeNum.toString()) {
      throw new AppError('Account code must be a numeric string (e.g., "1010")', 400, 'GL_INVALID_CODE_FORMAT');
    }

    if (code.length !== 4) {
      throw new AppError('Account code must be exactly 4 digits', 400, 'GL_INVALID_CODE_LENGTH');
    }

    const validRanges: Record<AccountType, { min: number; max: number }> = {
      asset: { min: 1000, max: 1999 },
      liability: { min: 2000, max: 2999 },
      equity: { min: 3000, max: 3999 },
      revenue: { min: 4000, max: 4999 },
      expense: { min: 5000, max: 5999 }
    };

    const range = validRanges[accountType];
    if (codeNum < range.min || codeNum > range.max) {
      throw new AppError(
        `Account code ${code} is invalid for ${accountType}. Must be between ${range.min}-${range.max}`,
        400,
        'GL_CODE_OUT_OF_RANGE'
      );
    }
  }

  /**
   * Parse ID string to number safely
   */
  private parseId(id: string, errorMessage: string = 'Invalid ID format'): number {
    const parsed = parseInt(id, 10);
    if (isNaN(parsed)) {
      throw new AppError(errorMessage, 400);
    }
    return parsed;
  }

  /**
   * Check for circular parent-child relationships
   * Traverses the parent chain to detect if setting parentId would create a cycle
   */
  private async checkCircularReference(accountId: number, parentId: number): Promise<void> {
    let currentId: number | null = parentId;
    const visited = new Set<number>([accountId]);

    while (currentId !== null) {
      if (visited.has(currentId)) {
        throw new AppError('Circular parent-child relationship detected', 400, 'GL_CIRCULAR_REFERENCE');
      }

      visited.add(currentId);

      const parent: { parentId: number | null } | null = await prisma.account.findUnique({
        where: { id: currentId },
        select: { parentId: true }
      });

      if (!parent) break;
      currentId = parent.parentId;
    }
  }

  /**
   * Generate unique journal entry number
   * Format: JE-YYYYMMDD-XXXXX (e.g., JE-20260117-00001)
   * Sequence resets daily
   */
  private async generateEntryNumber(tx?: Prisma.TransactionClient): Promise<string> {
    const client = tx || prisma;
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');

    // Use raw SQL to find and lock the last entry for today to prevent race conditions
    // This ensures only one process can generate the next sequence number at a time
    const result = await client.$queryRaw<any[]>`
      SELECT entry_number as "entryNumber"
      FROM journal_entries 
      WHERE entry_number LIKE ${'JE-' + dateStr + '-%'} 
      ORDER BY entry_number DESC 
      LIMIT 1 
      FOR UPDATE
    `;

    let sequence = 1;
    if (result && result.length > 0) {
      const lastEntryNumber = result[0].entryNumber;
      const lastSequence = parseInt(lastEntryNumber.split('-')[2], 10);
      if (!isNaN(lastSequence)) {
        sequence = lastSequence + 1;
      }
    }

    // Add a random 2-character suffix to practically eliminate collisions 
    // even if the lock is released or bypassed.
    const entropy = Math.random().toString(36).substring(2, 4).toUpperCase();
    return `JE-${dateStr}-${sequence.toString().padStart(5, '0')}-${entropy}`;
  }

  /**
   * Validate journal entry data
   * Ensures debits = credits with 0.01 tolerance
   * Minimum 2 transactions required
   * Accounts must be active
   */
  private async validateJournalEntry(data: CreateJournalEntryData): Promise<void> {
    if (data.transactions.length < 2) {
      throw new AppError('Minimum 2 transactions required for a journal entry', 400, 'GL_MIN_TRANSACTIONS');
    }

    const Decimal = Prisma.Decimal;
    let totalDebits = new Decimal(0);
    let totalCredits = new Decimal(0);

    // Verify accounts exist and are active in a single batch query (Fix N+1)
    const accountIds = [...new Set(data.transactions.map(txn => txn.accountId))];
    const accounts = await prisma.account.findMany({
      where: { id: { in: accountIds } },
      select: { id: true, isActive: true, name: true }
    });

    const accountMap = new Map(accounts.map(a => [a.id, a]));

    for (const txn of data.transactions) {
      const debit = new Decimal(txn.debitAmount);
      const credit = new Decimal(txn.creditAmount);

      // Cannot have both debit and credit
      if (!debit.isZero() && !credit.isZero()) {
        throw new AppError(
          `Transaction for account ${txn.accountId} cannot have both debit and credit amounts`,
          400
        );
      }

      // Must have either debit or credit (not both zero)
      if (debit.isZero() && credit.isZero()) {
        throw new AppError(
          `Transaction for account ${txn.accountId} must have either debit or credit amount`,
          400
        );
      }

      totalDebits = totalDebits.plus(debit);
      totalCredits = totalCredits.plus(credit);

      const account = accountMap.get(txn.accountId);

      if (!account) {
        throw new AppError(`Account ${txn.accountId} not found`, 404);
      }

      if (!account.isActive) {
        throw new AppError(`Account ${account.name} is inactive and cannot be used`, 400);
      }
    }

    // Check balance with 0.01 tolerance for floating-point precision
    const difference = totalDebits.minus(totalCredits).abs();
    if (difference.greaterThan(new Decimal(0.01))) {
      throw new AppError(
        `Journal entry not balanced. Debits: ${totalDebits.toString()}, Credits: ${totalCredits.toString()}`,
        400,
        'GL_UNBALANCED_ENTRY'
      );
    }
  }

  /**
   * Calculate balance change based on account's normal balance
   * Debit accounts: debits add, credits subtract
   * Credit accounts: credits add, debits subtract
   */
  private calculateBalanceChange(
    accountNormalBalance: NormalBalance,
    debitAmount: Prisma.Decimal,
    creditAmount: Prisma.Decimal
  ): Prisma.Decimal {
    if (accountNormalBalance === NormalBalance.debit) {
      // Assets, Expenses: debits increase, credits decrease
      return debitAmount.minus(creditAmount);
    } else {
      // Liabilities, Equity, Revenue: credits increase, debits decrease
      return creditAmount.minus(debitAmount);
    }
  }

  /**
   * Update account balance atomically within a transaction
   * Must be called within a Prisma transaction context
   */
  private async updateAccountBalance(
    accountId: number,
    debitAmount: Prisma.Decimal,
    creditAmount: Prisma.Decimal,
    tx: Prisma.TransactionClient
  ): Promise<Prisma.Decimal> {
    // Get account with row-level lock to prevent concurrent updates (FOR UPDATE)
    // This ensures that when multiple transactions try to update the same account, 
    // they are serialized to prevent race conditions.
    const accounts: any[] = await tx.$queryRaw`
      SELECT normal_balance as "normalBalance", current_balance as "currentBalance"
      FROM accounts
      WHERE id = ${accountId}
      FOR UPDATE
    `;

    if (!accounts || accounts.length === 0) {
      throw new AppError(`Account ${accountId} not found`, 404);
    }

    const normalBalance = accounts[0].normalBalance as NormalBalance;
    const currentBalance = new Prisma.Decimal(accounts[0].currentBalance);

    // Calculate balance change
    const balanceChange = this.calculateBalanceChange(
      normalBalance,
      debitAmount,
      creditAmount
    );

    const newBalance = currentBalance.plus(balanceChange);

    // Update account balance
    await tx.account.update({
      where: { id: accountId },
      data: {
        currentBalance: newBalance
      }
    });

    return newBalance;
  }

  /**
   * Get all accounts with filters and pagination
   */
  async getAllAccounts(filters: AccountFilters) {
    const { accountType, isActive, page = 1, limit = 50, startDate, endDate } = filters;

    const where: Prisma.AccountWhereInput = {};
    if (accountType) where.accountType = accountType;
    if (isActive !== undefined) where.isActive = isActive;

    const skip = (page - 1) * limit;

    const [accounts, total] = await Promise.all([
      prisma.account.findMany({
        where,
        skip,
        take: limit,
        include: {
          parent: {
            select: {
              id: true,
              code: true,
              name: true
            }
          },
          children: {
            select: {
              id: true,
              code: true,
              name: true
            }
          }
        },
        orderBy: { code: 'asc' }
      }),
      prisma.account.count({ where })
    ]);

    // Compute period activity per account when a date range is provided
    let periodActivityMap: Map<number, { debits: number; credits: number }> | null = null;
    if (startDate || endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
      const accountIds = accounts.map(a => a.id);
      const txns = await prisma.accountTransaction.findMany({
        where: {
          accountId: { in: accountIds },
          journalEntry: { entryDate: dateFilter, isVoided: false }
        },
        select: { accountId: true, debitAmount: true, creditAmount: true }
      });
      periodActivityMap = new Map();
      for (const txn of txns) {
        const existing = periodActivityMap.get(txn.accountId) ?? { debits: 0, credits: 0 };
        periodActivityMap.set(txn.accountId, {
          debits: existing.debits + Number(txn.debitAmount),
          credits: existing.credits + Number(txn.creditAmount)
        });
      }
    }

    const accountsWithActivity = accounts.map(acc => ({
      ...acc,
      periodActivity: periodActivityMap
        ? (periodActivityMap.get(acc.id) ?? { debits: 0, credits: 0 })
        : null
    }));

    return {
      accounts: accountsWithActivity,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get single account by ID
   */
  async getAccountById(accountId: string) {
    const id = this.parseId(accountId, 'Invalid account ID');

    const account = await prisma.account.findUnique({
      where: { id },
      include: {
        parent: {
          select: {
            id: true,
            code: true,
            name: true
          }
        },
        children: {
          select: {
            id: true,
            code: true,
            name: true
          }
        }
      }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    return account;
  }

  /**
   * Create new account
   */
  async createAccount(data: CreateAccountData, requester?: Requester) {
    const { code, name, description, accountType, normalBalance, parentId } = data;

    // Validate normal balance
    this.validateNormalBalance(accountType, normalBalance);

    // Validate account code
    this.validateAccountCode(code, accountType);

    // Check if code already exists
    const existing = await prisma.account.findUnique({
      where: { code }
    });

    if (existing) {
      throw new AppError(`Account code ${code} already exists`, 400);
    }

    // Validate parent exists if specified
    if (parentId) {
      const parent = await prisma.account.findUnique({
        where: { id: parentId }
      });

      if (!parent) {
        throw new AppError('Parent account not found', 404);
      }

      // Parent must be same account type
      if (parent.accountType !== accountType) {
        throw new AppError(
          `Parent account must be of type ${accountType}, but is ${parent.accountType}`,
          400
        );
      }
    }

    const account = await prisma.account.create({
      data: {
        code,
        name,
        description,
        accountType,
        normalBalance,
        parentId,
        isSystem: false // User-created accounts are never system accounts
      },
      include: {
        parent: {
          select: {
            id: true,
            code: true,
            name: true
          }
        }
      }
    });

    logger.info('Account created', {
      accountId: account.id,
      code: account.code,
      name: account.name,
      userId: requester?.id
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: requester?.id,
        action: 'create_account',
        resource: 'account',
        resourceId: account.id.toString(),
        metadata: { code, name, accountType }
      }
    });

    return account;
  }

  /**
   * Update account (only non-system fields)
   */
  async updateAccount(accountId: string, data: UpdateAccountData, requester?: Requester) {
    const { name, description, parentId } = data;

    const id = this.parseId(accountId, 'Invalid account ID');

    const account = await prisma.account.findUnique({
      where: { id }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    // Validate parent if changing
    if (parentId !== undefined) {
      if (parentId === null) {
        // Removing parent is OK
      } else {
        const parent = await prisma.account.findUnique({
          where: { id: parentId }
        });

        if (!parent) {
          throw new AppError('Parent account not found', 404);
        }

        // Parent must be same account type
        if (parent.accountType !== account.accountType) {
          throw new AppError(
            `Parent account must be of type ${account.accountType}, but is ${parent.accountType}`,
            400
          );
        }

        // Check for circular reference
        await this.checkCircularReference(account.id, parentId);
      }
    }

    const updated = await prisma.account.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(parentId !== undefined && { parentId })
      },
      include: {
        parent: {
          select: {
            id: true,
            code: true,
            name: true
          }
        },
        children: {
          select: {
            id: true,
            code: true,
            name: true
          }
        }
      }
    });

    logger.info('Account updated', {
      accountId: account.id,
      changes: data,
      userId: requester?.id
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: requester?.id,
        action: 'update_account',
        resource: 'account',
        resourceId: account.id.toString(),
        metadata: data
      }
    });

    return updated;
  }

  /**
   * Delete account (system accounts cannot be deleted)
   */
  async deleteAccount(accountId: string, requester?: Requester) {
    const id = this.parseId(accountId, 'Invalid account ID');

    const account = await prisma.account.findUnique({
      where: { id },
      include: {
        children: true
      }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    if (account.isSystem) {
      throw new AppError(
        'System accounts cannot be deleted. Use deactivate instead.',
        403
      );
    }

    if (account.children.length > 0) {
      throw new AppError(
        'Cannot delete account with child accounts. Delete or reassign children first.',
        400
      );
    }

    // Check for existing transactions before deletion
    const hasTransactions = await prisma.accountTransaction.count({
      where: { accountId: account.id }
    });

    if (hasTransactions > 0) {
      throw new AppError('Cannot delete account with existing transactions. Deactivate it instead.', 400);
    }

    await prisma.account.delete({
      where: { id }
    });

    logger.info('Account deleted', {
      accountId: account.id,
      code: account.code,
      userId: requester?.id
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: requester?.id,
        action: 'delete_account',
        resource: 'account',
        resourceId: account.id.toString(),
        metadata: { code: account.code, name: account.name }
      }
    });

    return { message: 'Account deleted successfully' };
  }

  /**
   * Toggle account active status
   */
  async toggleAccountStatus(accountId: string, isActive: boolean, requester?: Requester) {
    const id = this.parseId(accountId, 'Invalid account ID');

    const account = await prisma.account.findUnique({
      where: { id }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    const updated = await prisma.account.update({
      where: { id },
      data: { isActive }
    });

    logger.info('Account status toggled', {
      accountId: account.id,
      isActive,
      userId: requester?.id
    });

    // Create audit log
    await prisma.auditLog.create({
      data: {
        userId: requester?.id,
        action: 'toggle_account_status',
        resource: 'account',
        resourceId: account.id.toString(),
        metadata: { isActive }
      }
    });

    return updated;
  }

  /**
   * Create new journal entry with balanced debits/credits
   */
  async createJournalEntry(data: CreateJournalEntryData, requester?: Requester) {
    // Validate journal entry data
    await this.validateJournalEntry(data);

    return await prisma.$transaction(async (tx) => {
      // Generate entry number using the transaction client to maintain the lock
      const entryNumber = await this.generateEntryNumber(tx as Prisma.TransactionClient);

      // Update account balances and create transactions with running balance
      const transactionsWithRunningBalance = [];
      for (const txn of data.transactions) {
        const debitAmount = new Prisma.Decimal(txn.debitAmount);
        const creditAmount = new Prisma.Decimal(txn.creditAmount);

        const runningBalance = await this.updateAccountBalance(
          txn.accountId,
          debitAmount,
          creditAmount,
          tx as Prisma.TransactionClient
        );

        transactionsWithRunningBalance.push({
          accountId: txn.accountId,
          debitAmount,
          creditAmount,
          runningBalance,
          description: txn.description
        });
      }

      // Create journal entry with transactions
      const entry = await tx.journalEntry.create({
        data: {
          entryNumber,
          entryDate: new Date(data.entryDate),
          description: data.description,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
          createdBy: requester?.id || 0,
          transactions: {
            create: transactionsWithRunningBalance
          }
        },
        include: {
          transactions: {
            include: {
              account: {
                select: {
                  id: true,
                  code: true,
                  name: true
                }
              }
            }
          },
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true
            }
          }
        }
      });

      logger.info('Journal entry created', {
        entryId: entry.id,
        entryNumber: entry.entryNumber,
        sourceType: entry.sourceType,
        userId: requester?.id
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          userId: requester?.id,
          action: 'create_journal_entry',
          resource: 'journal_entry',
          resourceId: entry.id.toString(),
          metadata: {
            entryNumber: entry.entryNumber,
            description: entry.description,
            sourceType: entry.sourceType,
            transactionCount: entry.transactions.length
          }
        }
      });

      return entry;
    });
  }

  /**
   * Get all journal entries with filters and pagination
   */
  async getJournalEntries(filters: JournalEntryFilters) {
    const {
      sourceType,
      sourceId,
      isVoided,
      startDate,
      endDate,
      page = 1,
      limit = 50
    } = filters;

    const where: Prisma.JournalEntryWhereInput = {};
    if (sourceType) where.sourceType = sourceType;
    if (sourceId) where.sourceId = sourceId;
    if (isVoided !== undefined) where.isVoided = isVoided;
    if (startDate || endDate) {
      where.entryDate = {};
      if (startDate) where.entryDate.gte = new Date(startDate);
      if (endDate) where.entryDate.lte = new Date(endDate);
    }

    const skip = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        skip,
        take: limit,
        include: {
          transactions: {
            include: {
              account: {
                select: {
                  id: true,
                  code: true,
                  name: true
                }
              }
            }
          },
          creator: {
            select: {
              id: true,
              firstName: true,
              lastName: true
            }
          },
          voider: {
            select: {
              id: true,
              firstName: true,
              lastName: true
            }
          }
        },
        orderBy: { entryDate: 'desc' }
      }),
      prisma.journalEntry.count({ where })
    ]);

    return {
      entries,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get single journal entry by ID
   */
  async getJournalEntryById(entryId: string) {
    const id = this.parseId(entryId, 'Invalid journal entry ID');

    const entry = await prisma.journalEntry.findUnique({
      where: { id },
      include: {
        transactions: {
          include: {
            account: {
              select: {
                id: true,
                code: true,
                name: true,
                accountType: true
              }
            }
          },
          orderBy: { id: 'asc' }
        },
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        voider: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        reverses: {
          select: {
            id: true,
            entryNumber: true,
            description: true
          }
        }
      }
    });

    if (!entry) {
      throw new AppError('Journal entry not found', 404);
    }

    return entry;
  }

  /**
   * Void journal entry by creating reversing entry
   */
  async voidJournalEntry(entryId: string, reason: string, requester?: Requester) {
    const id = this.parseId(entryId, 'Invalid journal entry ID');

    return await prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findUnique({
        where: { id },
        include: { transactions: true }
      });

      if (!entry) {
        throw new AppError('Journal entry not found', 404);
      }

      if (entry.isVoided) {
        throw new AppError('Journal entry is already voided', 400);
      }

      // Create reversing entry with swapped debits/credits
      const reversingEntryNumber = await this.generateEntryNumber(tx as Prisma.TransactionClient);
      const reversingEntry = await tx.journalEntry.create({
        data: {
          entryNumber: reversingEntryNumber,
          entryDate: new Date(),
          description: `VOID: ${entry.description}`,
          sourceType: JournalSourceType.reversal,
          sourceId: entry.id,
          createdBy: requester?.id || 0,
          transactions: {
            create: entry.transactions.map(t => ({
              accountId: t.accountId,
              debitAmount: t.creditAmount,  // Swapped
              creditAmount: t.debitAmount,   // Swapped
              description: `Reversal of ${entry.entryNumber}`
            }))
          }
        },
        include: {
          transactions: true
        }
      });

      // Update balances for reversal
      for (const txn of reversingEntry.transactions) {
        await this.updateAccountBalance(
          txn.accountId,
          txn.debitAmount,
          txn.creditAmount,
          tx as Prisma.TransactionClient
        );
      }

      // Mark original as voided
      const voided = await tx.journalEntry.update({
        where: { id },
        data: {
          isVoided: true,
          voidedAt: new Date(),
          voidedBy: requester?.id,
          voidReason: reason,
          reversingEntryId: reversingEntry.id
        },
        include: {
          transactions: {
            include: {
              account: {
                select: {
                  id: true,
                  code: true,
                  name: true
                }
              }
            }
          },
          reverses: {
            select: {
              id: true,
              entryNumber: true
            }
          }
        }
      });

      logger.info('Journal entry voided', {
        entryId: entry.id,
        entryNumber: entry.entryNumber,
        reversingEntryId: reversingEntry.id,
        reversingEntryNumber: reversingEntry.entryNumber,
        userId: requester?.id
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          userId: requester?.id,
          action: 'void_journal_entry',
          resource: 'journal_entry',
          resourceId: entry.id.toString(),
          metadata: {
            entryNumber: entry.entryNumber,
            voidReason: reason,
            reversingEntryId: reversingEntry.id,
            reversingEntryNumber: reversingEntry.entryNumber
          }
        }
      });

      return voided;
    });
  }

  /**
   * Get account balance (cached from currentBalance field)
   */
  async getAccountBalance(accountId: string) {
    const id = this.parseId(accountId, 'Invalid account ID');

    const account = await prisma.account.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        accountType: true,
        normalBalance: true,
        currentBalance: true,
        isActive: true
      }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    return account;
  }

  /**
   * Get account ledger (transaction history)
   */
  async getAccountLedger(accountId: string, filters: AccountLedgerFilters) {
    const id = this.parseId(accountId, 'Invalid account ID');

    const account = await prisma.account.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        accountType: true,
        normalBalance: true,
        currentBalance: true
      }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    const { startDate, endDate, page = 1, limit = 100 } = filters;

    const where: Prisma.AccountTransactionWhereInput = {
      accountId: id
    };

    // Filter by journal entry date if provided
    if (startDate || endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);
      where.journalEntry = { entryDate: dateFilter };
    }

    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      prisma.accountTransaction.findMany({
        where,
        skip,
        take: limit,
        include: {
          journalEntry: {
            select: {
              id: true,
              entryNumber: true,
              entryDate: true,
              description: true,
              sourceType: true,
              isVoided: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.accountTransaction.count({ where })
    ]);

    return {
      account,
      transactions,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Recalculate account balance from transactions (utility for verification/repair)
   */
  async recalculateAccountBalance(accountId: string) {
    const id = this.parseId(accountId, 'Invalid account ID');

    const account = await prisma.account.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        normalBalance: true,
        currentBalance: true
      }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    // Get all transactions for this account (excluding voided entries)
    const transactions = await prisma.accountTransaction.findMany({
      where: {
        accountId: id,
        journalEntry: {
          isVoided: false
        }
      },
      select: {
        debitAmount: true,
        creditAmount: true
      }
    });

    // Calculate balance from scratch
    const Decimal = Prisma.Decimal;
    let calculatedBalance = new Decimal(0);

    for (const txn of transactions) {
      const balanceChange = this.calculateBalanceChange(
        account.normalBalance,
        txn.debitAmount,
        txn.creditAmount
      );
      calculatedBalance = calculatedBalance.plus(balanceChange);
    }

    // Update account with recalculated balance
    const updated = await prisma.account.update({
      where: { id },
      data: {
        currentBalance: calculatedBalance
      },
      select: {
        id: true,
        code: true,
        name: true,
        currentBalance: true
      }
    });

    logger.info('Account balance recalculated', {
      accountId: id,
      previousBalance: account.currentBalance.toString(),
      newBalance: calculatedBalance.toString(),
      transactionCount: transactions.length
    });

    return {
      account: updated,
      previousBalance: account.currentBalance,
      newBalance: calculatedBalance,
      difference: calculatedBalance.minus(account.currentBalance),
      transactionCount: transactions.length
    };
  }
  /**
   * Export account ledger to CSV
   * Optimized for large datasets by fetching in chunks
   */
  async exportAccountLedgerToCSV(accountId: string, filters: AccountLedgerFilters) {
    const id = this.parseId(accountId, 'Invalid account ID');

    // Get account info first
    const account = await prisma.account.findUnique({
      where: { id },
      select: { code: true }
    });

    if (!account) {
      throw new AppError('Account not found', 404);
    }

    const { startDate, endDate } = filters;
    const where: Prisma.AccountTransactionWhereInput = { accountId: id };

    if (startDate || endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) dateFilter.lte = new Date(endDate);
      where.journalEntry = { entryDate: dateFilter };
    }

    // Fetch in chunks of 2000 to avoid memory overflow but keep performance
    const chunkSize = 2000;
    let skip = 0;
    let allData: any[] = [];
    let hasMore = true;

    while (hasMore) {
      const chunk = await prisma.accountTransaction.findMany({
        where,
        skip,
        take: chunkSize,
        include: {
          journalEntry: {
            select: {
              entryNumber: true,
              entryDate: true,
              description: true,
              sourceType: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }) as any[];

      if (chunk.length === 0) {
        hasMore = false;
      } else {
        const mappedChunk = chunk.map((t) => ({
          Date: t.journalEntry.entryDate.toISOString().split('T')[0],
          EntryNumber: t.journalEntry.entryNumber,
          Description: t.description || t.journalEntry.description,
          Source: t.journalEntry.sourceType,
          Debit: t.debitAmount.toNumber(),
          Credit: t.creditAmount.toNumber(),
          RunningBalance: t.runningBalance.toNumber()
        }));

        allData = allData.concat(mappedChunk);
        skip += chunkSize;

        // Safety cap for extremely large exports to prevent timeout (can be adjusted)
        if (allData.length >= 50000) {
          hasMore = false;
        }

        if (chunk.length < chunkSize) {
          hasMore = false;
        }
      }
    }

    const fields = [
      'Date',
      'EntryNumber',
      'Description',
      'Source',
      'Debit',
      'Credit',
      'RunningBalance'
    ];

    const { Parser } = require('json2csv');
    const parser = new Parser({ fields });
    const csv = parser.parse(allData);

    return {
      csv,
      filename: `ledger-${account.code}-${new Date().toISOString().split('T')[0]}.csv`
    };
  }
}

export default new GLService();
