import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Prisma, AccountType, NormalBalance } from '@prisma/client';
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

    return updated;
  }
}

export default new GLService();
