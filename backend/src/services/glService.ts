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
        400
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
      throw new AppError('Account code must be a numeric string (e.g., "1010")', 400);
    }

    if (code.length !== 4) {
      throw new AppError('Account code must be exactly 4 digits', 400);
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
        400
      );
    }
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
        throw new AppError('Circular parent-child relationship detected', 400);
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
  private async generateEntryNumber(): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');

    const lastEntry = await prisma.journalEntry.findFirst({
      where: { entryNumber: { startsWith: `JE-${dateStr}-` } },
      orderBy: { entryNumber: 'desc' },
      select: { entryNumber: true }
    });

    let sequence = 1;
    if (lastEntry) {
      const lastSequence = parseInt(lastEntry.entryNumber.split('-')[2], 10);
      sequence = lastSequence + 1;
    }

    return `JE-${dateStr}-${sequence.toString().padStart(5, '0')}`;
  }

  /**
   * Validate journal entry data
   * Ensures debits = credits with 0.01 tolerance
   * Minimum 2 transactions required
   * Accounts must be active
   */
  private async validateJournalEntry(data: CreateJournalEntryData): Promise<void> {
    if (data.transactions.length < 2) {
      throw new AppError('Minimum 2 transactions required for a journal entry', 400);
    }

    const Decimal = Prisma.Decimal;
    let totalDebits = new Decimal(0);
    let totalCredits = new Decimal(0);

    // Validate each transaction and accumulate totals
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

      // Verify account exists and is active
      const account = await prisma.account.findUnique({
        where: { id: txn.accountId },
        select: { isActive: true, name: true }
      });

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
        400
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
  ): Promise<void> {
    // Get account to determine normal balance
    const account = await tx.account.findUnique({
      where: { id: accountId },
      select: { normalBalance: true, currentBalance: true }
    });

    if (!account) {
      throw new AppError(`Account ${accountId} not found`, 404);
    }

    // Calculate balance change
    const balanceChange = this.calculateBalanceChange(
      account.normalBalance,
      debitAmount,
      creditAmount
    );

    // Update account balance
    await tx.account.update({
      where: { id: accountId },
      data: {
        currentBalance: account.currentBalance.plus(balanceChange)
      }
    });
  }

  /**
   * Get all accounts with filters and pagination
   */
  async getAllAccounts(filters: AccountFilters) {
    const { accountType, isActive, page = 1, limit = 50 } = filters;

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

    return {
      accounts,
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
    const id = parseInt(accountId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid account ID', 400);
    }

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

    const id = parseInt(accountId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid account ID', 400);
    }

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
    const id = parseInt(accountId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid account ID', 400);
    }

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

    // TODO: Future - check for existing journal entries
    // const hasEntries = await prisma.journalEntry.count({
    //   where: { accountId: account.id }
    // });
    // if (hasEntries > 0) {
    //   throw new AppError('Cannot delete account with existing journal entries', 400);
    // }

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
    const id = parseInt(accountId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid account ID', 400);
    }

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
      // Generate unique entry number
      const entryNumber = await this.generateEntryNumber();

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
            create: data.transactions.map(txn => ({
              accountId: txn.accountId,
              debitAmount: new Prisma.Decimal(txn.debitAmount),
              creditAmount: new Prisma.Decimal(txn.creditAmount),
              description: txn.description
            }))
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

      // Update account balances for all transactions
      for (const txn of entry.transactions) {
        await this.updateAccountBalance(
          txn.accountId,
          txn.debitAmount,
          txn.creditAmount,
          tx as Prisma.TransactionClient
        );
      }

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
    const id = parseInt(entryId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid journal entry ID', 400);
    }

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
  async voidJournalEntry(entryId: string, voidReason: string, requester?: Requester) {
    const id = parseInt(entryId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid journal entry ID', 400);
    }

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
      const reversingEntryNumber = await this.generateEntryNumber();
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
          voidReason,
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
            voidReason,
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
    const id = parseInt(accountId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid account ID', 400);
    }

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
    const id = parseInt(accountId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid account ID', 400);
    }

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
      where.journalEntry = {};
      if (startDate) where.journalEntry.entryDate = { gte: new Date(startDate) };
      if (endDate) where.journalEntry.entryDate = { lte: new Date(endDate) };
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
    const id = parseInt(accountId, 10);
    if (isNaN(id)) {
      throw new AppError('Invalid account ID', 400);
    }

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
}

export default new GLService();
