import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock server module to prevent it from starting
jest.mock('../../server', () => {
  const m = {
    emit: jest.fn(),
    to: jest.fn(),
  };
  m.to.mockReturnValue(m);
  return { io: m };
});

import { prismaMock } from '../mocks/prisma.mock';
import glService from '../../services/glService';
import { AppError } from '../../middleware/errorHandler';
import { AccountType, NormalBalance, Prisma } from '@prisma/client';

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));

describe('GLService', () => {
  const mockUser = {
    id: 1,
    email: 'admin@test.com',
    role: 'super_admin' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAllAccounts', () => {
    it('should return paginated accounts with filters', async () => {
      const mockAccounts = [
        {
          id: 1,
          code: '1010',
          name: 'Cash in Hand',
          description: 'Bank account cash balances',
          accountType: AccountType.asset,
          normalBalance: NormalBalance.debit,
          parentId: null,
          isSystem: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          parent: null,
          children: [],
        },
      ];

      (prismaMock.account.findMany as any).mockResolvedValue([mockAccounts[0]]);
      (prismaMock.account.count as any).mockResolvedValue(1);

      const result = await glService.getAllAccounts({
        accountType: AccountType.asset,
        isActive: true,
        page: 1,
        limit: 50,
      });

      expect(result.accounts).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.pages).toBe(1);
      expect(prismaMock.account.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { accountType: AccountType.asset, isActive: true },
        })
      );
    });

    it('should return all accounts without filters', async () => {
      const mockAccounts = [
        {
          id: 1,
          code: '1010',
          name: 'Cash in Hand',
          accountType: AccountType.asset,
          normalBalance: NormalBalance.debit,
          parentId: null,
          isSystem: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          parent: null,
          children: [],
        },
        {
          id: 2,
          code: '2010',
          name: 'Accounts Payable',
          accountType: AccountType.liability,
          normalBalance: NormalBalance.credit,
          parentId: null,
          isSystem: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          parent: null,
          children: [],
        },
      ];

      (prismaMock.account.findMany as any).mockResolvedValue(mockAccounts);
      (prismaMock.account.count as any).mockResolvedValue(2);

      const result = await glService.getAllAccounts({});

      expect(result.accounts).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
    });
  });

  describe('getAccountById', () => {
    it('should return account with parent and children', async () => {
      const mockAccount = {
        id: 1,
        code: '1010',
        name: 'Cash in Hand',
        description: 'Bank account cash balances',
        accountType: AccountType.asset,
        normalBalance: NormalBalance.debit,
        parentId: null,
        isSystem: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        parent: null,
        children: [],
      };

      (prismaMock.account.findUnique as any).mockResolvedValue(mockAccount as any);

      const result = await glService.getAccountById('1');

      expect(result).toEqual(mockAccount);
      expect(prismaMock.account.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: {
          parent: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          children: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      });
    });

    it('should throw error if account not found', async () => {
      (prismaMock.account.findUnique as any).mockResolvedValue(null);

      await expect(glService.getAccountById('999')).rejects.toThrow(
        new AppError('Account not found', 404)
      );
    });
  });

  describe('createAccount - Validation', () => {
    it('should reject asset account with credit normal balance', async () => {
      const accountData = {
        code: '1050',
        name: 'Test Asset',
        accountType: AccountType.asset,
        normalBalance: NormalBalance.credit,
      };

      await expect(glService.createAccount(accountData, mockUser)).rejects.toThrow(
        new AppError(
          'Invalid normal balance for asset account. Expected debit, got credit',
          400
        )
      );
    });

    it('should reject expense account with credit normal balance', async () => {
      const accountData = {
        code: '5060',
        name: 'Test Expense',
        accountType: AccountType.expense,
        normalBalance: NormalBalance.credit,
      };

      await expect(glService.createAccount(accountData, mockUser)).rejects.toThrow(
        new AppError(
          'Invalid normal balance for expense account. Expected debit, got credit',
          400
        )
      );
    });

    it('should reject liability account with debit normal balance', async () => {
      const accountData = {
        code: '2050',
        name: 'Test Liability',
        accountType: AccountType.liability,
        normalBalance: NormalBalance.debit,
      };

      await expect(glService.createAccount(accountData, mockUser)).rejects.toThrow(
        new AppError(
          'Invalid normal balance for liability account. Expected credit, got debit',
          400
        )
      );
    });

    it('should reject equity account with debit normal balance', async () => {
      const accountData = {
        code: '3050',
        name: 'Test Equity',
        accountType: AccountType.equity,
        normalBalance: NormalBalance.debit,
      };

      await expect(glService.createAccount(accountData, mockUser)).rejects.toThrow(
        new AppError(
          'Invalid normal balance for equity account. Expected credit, got debit',
          400
        )
      );
    });

    it('should reject revenue account with debit normal balance', async () => {
      const accountData = {
        code: '4050',
        name: 'Test Revenue',
        accountType: AccountType.revenue,
        normalBalance: NormalBalance.debit,
      };

      await expect(glService.createAccount(accountData, mockUser)).rejects.toThrow(
        new AppError(
          'Invalid normal balance for revenue account. Expected credit, got debit',
          400
        )
      );
    });

    it('should reject account code not in correct range for asset', async () => {
      const accountData = {
        code: '2050',
        name: 'Invalid Asset',
        accountType: AccountType.asset,
        normalBalance: NormalBalance.debit,
      };

      await expect(glService.createAccount(accountData, mockUser)).rejects.toThrow(
        new AppError('Account code 2050 is invalid for asset. Must be between 1000-1999', 400)
      );
    });

    it('should reject account code not in correct range for liability', async () => {
      const accountData = {
        code: '1050',
        name: 'Invalid Liability',
        accountType: AccountType.liability,
        normalBalance: NormalBalance.credit,
      };

      await expect(glService.createAccount(accountData, mockUser)).rejects.toThrow(
        new AppError('Account code 1050 is invalid for liability. Must be between 2000-2999', 400)
      );
    });

    it('should reject account code not in correct range for equity', async () => {
      const accountData = {
        code: '1050',
        name: 'Invalid Equity',
        accountType: AccountType.equity,
        normalBalance: NormalBalance.credit,
      };

      await expect(glService.createAccount(accountData, mockUser)).rejects.toThrow(
        new AppError('Account code 1050 is invalid for equity. Must be between 3000-3999', 400)
      );
    });

    it('should reject account code not in correct range for revenue', async () => {
      const accountData = {
        code: '1050',
        name: 'Invalid Revenue',
        accountType: AccountType.revenue,
        normalBalance: NormalBalance.credit,
      };

      await expect(glService.createAccount(accountData, mockUser)).rejects.toThrow(
        new AppError('Account code 1050 is invalid for revenue. Must be between 4000-4999', 400)
      );
    });

    it('should reject account code not in correct range for expense', async () => {
      const accountData = {
        code: '1050',
        name: 'Invalid Expense',
        accountType: AccountType.expense,
        normalBalance: NormalBalance.debit,
      };

      await expect(glService.createAccount(accountData, mockUser)).rejects.toThrow(
        new AppError('Account code 1050 is invalid for expense. Must be between 5000-5999', 400)
      );
    });

    it('should reject duplicate account code', async () => {
      const accountData = {
        code: '1010',
        name: 'Duplicate Code',
        accountType: AccountType.asset,
        normalBalance: NormalBalance.debit,
      };

      (prismaMock.account.findUnique as any).mockResolvedValueOnce({
        id: 1,
        code: '1010',
        name: 'Cash in Hand',
      } as any);

      await expect(glService.createAccount(accountData, mockUser)).rejects.toThrow(
        new AppError('Account code 1010 already exists', 400)
      );
    });

    it('should reject parent that does not exist', async () => {
      const accountData = {
        code: '1050',
        name: 'Test Account',
        accountType: AccountType.asset,
        normalBalance: NormalBalance.debit,
        parentId: 999,
      };

      (prismaMock.account.findUnique as any)
        .mockResolvedValueOnce(null) // Code check
        .mockResolvedValueOnce(null); // Parent check

      await expect(glService.createAccount(accountData, mockUser)).rejects.toThrow(
        new AppError('Parent account not found', 404)
      );
    });

    it('should reject parent with different account type', async () => {
      const accountData = {
        code: '1050',
        name: 'Test Account',
        accountType: AccountType.asset,
        normalBalance: NormalBalance.debit,
        parentId: 1,
      };

      (prismaMock.account.findUnique as any)
        .mockResolvedValueOnce(null) // Code check
        .mockResolvedValueOnce({
          id: 1,
          code: '2010',
          name: 'Liability Parent',
          accountType: AccountType.liability,
        } as any); // Parent check

      await expect(glService.createAccount(accountData, mockUser)).rejects.toThrow(
        new AppError('Parent account must be of type asset, but is liability', 400)
      );
    });

  });

  describe('createAccount - Success Cases', () => {
    it('should create asset account with valid data', async () => {
      const accountData = {
        code: '1050',
        name: 'Petty Cash',
        description: 'Small cash for daily expenses',
        accountType: AccountType.asset,
        normalBalance: NormalBalance.debit,
      };

      const mockCreatedAccount = {
        id: 1,
        ...accountData,
        parentId: null,
        isSystem: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prismaMock.account.findUnique as any).mockResolvedValueOnce(null); // No duplicate code
      (prismaMock.account.create as any).mockResolvedValue(mockCreatedAccount as any);
      (prismaMock.auditLog.create as any).mockResolvedValue({} as any);

      const result = await glService.createAccount(accountData, mockUser);

      expect(result).toEqual(mockCreatedAccount);
      expect(prismaMock.account.create).toHaveBeenCalled();
      const createCall = (prismaMock.account.create as any).mock.calls[0][0];
      expect(createCall.data).toMatchObject({
        code: '1050',
        name: 'Petty Cash',
        accountType: AccountType.asset,
        normalBalance: NormalBalance.debit,
      });

      expect(prismaMock.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          action: 'create_account',
          resource: 'account',
          resourceId: '1'
        })
      }));
    });

    it('should create account with valid parent', async () => {
      const accountData = {
        code: '1051',
        name: 'Sub Account',
        accountType: AccountType.asset,
        normalBalance: NormalBalance.debit,
        parentId: 1,
      };

      const mockParent = {
        id: 1,
        code: '1050',
        name: 'Parent Account',
        accountType: AccountType.asset,
        parentId: null,
      };

      const mockCreatedAccount = {
        id: 2,
        ...accountData,
        isSystem: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (prismaMock.account.findUnique as any)
        .mockResolvedValueOnce(null) // Code check
        .mockResolvedValueOnce(mockParent as any) // Parent check
        .mockResolvedValueOnce({ id: 1, parentId: null } as any); // Circular check

      (prismaMock.account.create as any).mockResolvedValue(mockCreatedAccount as any);

      const result = await glService.createAccount(accountData, mockUser);

      expect(result.parentId).toBe(1);
    });
  });

  describe('updateAccount', () => {
    it('should update account name and description', async () => {
      const mockExistingAccount = {
        id: 1,
        code: '1050',
        name: 'Old Name',
        description: 'Old description',
        accountType: AccountType.asset,
        normalBalance: NormalBalance.debit,
        parentId: null,
        isSystem: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updateData = {
        name: 'New Name',
        description: 'New description',
      };

      const mockUpdatedAccount = {
        ...mockExistingAccount,
        ...updateData,
      };

      (prismaMock.account.findUnique as any).mockResolvedValue(mockExistingAccount as any);
      (prismaMock.account.update as any).mockResolvedValue(mockUpdatedAccount as any);
      (prismaMock.auditLog.create as any).mockResolvedValue({} as any);

      const result = await glService.updateAccount('1', updateData, mockUser);

      expect(result.name).toBe('New Name');
      expect(result.description).toBe('New description');
      expect(prismaMock.account.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: updateData,
        include: {
          parent: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          children: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
        },
      });
    });

    it('should throw error if account not found', async () => {
      (prismaMock.account.findUnique as any).mockResolvedValue(null);

      await expect(
        glService.updateAccount('999', { name: 'New Name' }, mockUser)
      ).rejects.toThrow(new AppError('Account not found', 404));
    });

    it('should update parent successfully', async () => {
      const mockExistingAccount = {
        id: 2,
        code: '1051',
        name: 'Child Account',
        accountType: AccountType.asset,
        normalBalance: NormalBalance.debit,
        parentId: null,
        isSystem: false,
        isActive: true,
      };

      const mockNewParent = {
        id: 1,
        code: '1050',
        name: 'Parent Account',
        accountType: AccountType.asset,
      };

      (prismaMock.account.findUnique as any)
        .mockResolvedValueOnce(mockExistingAccount as any) // Existing account
        .mockResolvedValueOnce(mockNewParent as any) // New parent
        .mockResolvedValueOnce({ id: 1, parentId: null } as any); // Circular check

      (prismaMock.account.update as any).mockResolvedValue({
        ...mockExistingAccount,
        parentId: 1,
      } as any);

      (prismaMock.auditLog.create as any).mockResolvedValue({} as any);

      const result = await glService.updateAccount('2', { parentId: 1 }, mockUser);

      expect(result.parentId).toBe(1);
    });

    it('should reject parent with different account type on update', async () => {
      const mockExistingAccount = {
        id: 2,
        code: '1051',
        name: 'Asset Account',
        accountType: AccountType.asset,
        parentId: null,
      };

      const mockNewParent = {
        id: 1,
        code: '2010',
        name: 'Liability Parent',
        accountType: AccountType.liability,
      };

      (prismaMock.account.findUnique as any)
        .mockResolvedValueOnce(mockExistingAccount as any)
        .mockResolvedValueOnce(mockNewParent as any);

      await expect(
        glService.updateAccount('2', { parentId: 1 }, mockUser)
      ).rejects.toThrow(new AppError('Parent account must be of type asset, but is liability', 400));
    });
  });

  describe('deleteAccount', () => {
    it('should throw error if account not found', async () => {
      (prismaMock.account.findUnique as any).mockResolvedValue(null);

      await expect(glService.deleteAccount('999', mockUser)).rejects.toThrow(
        new AppError('Account not found', 404)
      );
    });

    it('should prevent deletion of system accounts', async () => {
      const mockSystemAccount = {
        id: 1,
        code: '1010',
        name: 'Cash in Hand',
        isSystem: true,
        children: [],
      };

      (prismaMock.account.findUnique as any).mockResolvedValue(mockSystemAccount as any);

      await expect(glService.deleteAccount('1', mockUser)).rejects.toThrow(
        new AppError('System accounts cannot be deleted. Use deactivate instead.', 403)
      );
    });

    it('should prevent deletion of accounts with children', async () => {
      const mockAccountWithChildren = {
        id: 1,
        code: '1050',
        name: 'Parent Account',
        isSystem: false,
        children: [{ id: 2 }],
      };

      (prismaMock.account.findUnique as any).mockResolvedValue(mockAccountWithChildren as any);

      await expect(glService.deleteAccount('1', mockUser)).rejects.toThrow(
        new AppError('Cannot delete account with child accounts. Delete or reassign children first.', 400)
      );
    });

    it('should delete non-system account without children', async () => {
      const mockAccount = {
        id: 1,
        code: '1050',
        name: 'Deletable Account',
        isSystem: false,
        children: [],
      };

      (prismaMock.account.findUnique as any).mockResolvedValue(mockAccount);
      (prismaMock.account.delete as any).mockResolvedValue(mockAccount);
      (prismaMock.auditLog.create as any).mockResolvedValue({} as any);

      await glService.deleteAccount('1', mockUser);

      expect(prismaMock.account.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });
  });

  describe('toggleAccountStatus', () => {
    it('should activate account', async () => {
      const mockAccount = {
        id: 1,
        code: '1050',
        name: 'Test Account',
        isActive: false,
      };

      const mockUpdatedAccount = {
        ...mockAccount,
        isActive: true,
      };

      (prismaMock.account.findUnique as any).mockResolvedValue(mockAccount as any);
      (prismaMock.account.update as any).mockResolvedValue(mockUpdatedAccount as any);
      (prismaMock.auditLog.create as any).mockResolvedValue({} as any);

      const result = await glService.toggleAccountStatus('1', true, mockUser);

      expect(result.isActive).toBe(true);
      expect(prismaMock.account.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { isActive: true },
      });
    });

    it('should deactivate account', async () => {
      const mockAccount = {
        id: 1,
        code: '1050',
        name: 'Test Account',
        isActive: true,
      };

      const mockUpdatedAccount = {
        ...mockAccount,
        isActive: false,
      };

      (prismaMock.account.findUnique as any).mockResolvedValue(mockAccount as any);
      (prismaMock.account.update as any).mockResolvedValue(mockUpdatedAccount as any);
      (prismaMock.auditLog.create as any).mockResolvedValue({} as any);

      const result = await glService.toggleAccountStatus('1', false, mockUser);

      expect(result.isActive).toBe(false);
    });

    it('should throw error if account not found', async () => {
      (prismaMock.account.findUnique as any).mockResolvedValue(null);

      await expect(glService.toggleAccountStatus('999', true, mockUser)).rejects.toThrow(
        new AppError('Account not found', 404)
      );
    });
  });

  describe('createJournalEntry', () => {
    const entryData = {
      entryDate: new Date().toISOString(),
      description: 'Test Entry',
      sourceType: 'manual' as any,
      transactions: [
        { accountId: 1, debitAmount: '100', creditAmount: '0', description: 'Debit' },
        { accountId: 2, debitAmount: '0', creditAmount: '100', description: 'Credit' }
      ]
    };

    it('should create balanced journal entry successfully', async () => {
      // Mock generateEntryNumber (raw query)
      (prismaMock.$queryRaw as any).mockResolvedValue([]);

      // Mock account validation
      (prismaMock.account.findMany as any).mockResolvedValue([
        { id: 1, isActive: true, name: 'Cash', normalBalance: 'debit' },
        { id: 2, isActive: true, name: 'Revenue', normalBalance: 'credit' }
      ]);

      // Mock transaction items
      const mockCreatedEntry = {
        id: 10,
        entryNumber: 'JE-20260117-00001',
        ...entryData,
        transactions: [
          { accountId: 1, debitAmount: new Prisma.Decimal('100'), creditAmount: new Prisma.Decimal('0') },
          { accountId: 2, debitAmount: new Prisma.Decimal('0'), creditAmount: new Prisma.Decimal('100') }
        ]
      };
      (prismaMock.$transaction as any).mockImplementation(async (callback: any) => {
        return callback(prismaMock);
      });

      (prismaMock.journalEntry.create as any).mockResolvedValue(mockCreatedEntry);
      (prismaMock.accountTransaction.createMany as any).mockResolvedValue({ count: 2 });
      (prismaMock.account.findUnique as any).mockResolvedValue({
        id: 1,
        normalBalance: 'debit',
        currentBalance: new Prisma.Decimal('0')
      });
      (prismaMock.account.update as any).mockResolvedValue({});
      (prismaMock.auditLog.create as any).mockResolvedValue({});

      const result = await glService.createJournalEntry(entryData, mockUser);

      expect(result.id).toBe(10);
      expect(prismaMock.journalEntry.create).toHaveBeenCalled();
    });

    it('should reject unbalanced journal entry', async () => {
      const unbalancedData = {
        ...entryData,
        transactions: [
          { accountId: 1, debitAmount: '100', creditAmount: '0' },
          { accountId: 2, debitAmount: '0', creditAmount: '90' }
        ]
      };

      (prismaMock.account.findMany as any).mockResolvedValue([
        { id: 1, isActive: true, name: 'Cash' },
        { id: 2, isActive: true, name: 'Revenue' }
      ]);

      await expect(glService.createJournalEntry(unbalancedData, mockUser)).rejects.toThrow(
        /Journal entry not balanced/
      );
    });

    it('should reject inactive account', async () => {
      (prismaMock.account.findMany as any).mockResolvedValue([
        { id: 1, isActive: false, name: 'Inactive Account' },
        { id: 2, isActive: true, name: 'Active Account' }
      ]);

      await expect(glService.createJournalEntry(entryData, mockUser)).rejects.toThrow(
        /is inactive and cannot be used/
      );
    });
  });

  describe('getAccountLedger - Date Filtering', () => {
    it('should apply both startDate and endDate filters correctly', async () => {
      const filters = {
        startDate: '2026-01-01',
        endDate: '2026-01-31'
      };

      (prismaMock.account.findUnique as any).mockResolvedValue({ id: 1, name: 'Cash' });
      (prismaMock.accountTransaction.findMany as any).mockResolvedValue([]);
      (prismaMock.accountTransaction.count as any).mockResolvedValue(0);

      await glService.getAccountLedger('1', filters);

      expect(prismaMock.accountTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            journalEntry: {
              entryDate: {
                gte: new Date(filters.startDate),
                lte: new Date(filters.endDate)
              }
            }
          })
        })
      );
    });
  });

  describe('voidJournalEntry', () => {
    it('should void entry and create reversing entry', async () => {
      const mockEntry = {
        id: 10,
        entryNumber: 'JE-001',
        description: 'Test',
        transactions: [
          { accountId: 1, debitAmount: new Prisma.Decimal('100'), creditAmount: new Prisma.Decimal('0') },
          { accountId: 2, debitAmount: new Prisma.Decimal('0'), creditAmount: new Prisma.Decimal('100') }
        ]
      };

      (prismaMock.$transaction as any).mockImplementation(async (callback: any) => {
        return callback(prismaMock);
      });

      (prismaMock.journalEntry.findUnique as any).mockResolvedValue(mockEntry);
      (prismaMock.journalEntry.create as any).mockResolvedValue({
        id: 11,
        entryNumber: 'JE-001-REV',
        transactions: [
          { accountId: 1, debitAmount: new Prisma.Decimal('0'), creditAmount: new Prisma.Decimal('100') },
          { accountId: 2, debitAmount: new Prisma.Decimal('100'), creditAmount: new Prisma.Decimal('0') }
        ]
      });
      (prismaMock.accountTransaction.createMany as any).mockResolvedValue({ count: 2 });
      (prismaMock.journalEntry.update as any).mockResolvedValue({ ...mockEntry, isVoided: true });
      (prismaMock.account.findUnique as any).mockResolvedValue({
        id: 1,
        normalBalance: 'debit',
        currentBalance: new Prisma.Decimal('0')
      });
      (prismaMock.account.update as any).mockResolvedValue({});
      (prismaMock.auditLog.create as any).mockResolvedValue({});

      const result = await glService.voidJournalEntry('10', 'Mistake', mockUser);

      expect(result.isVoided).toBe(true);
      expect(prismaMock.journalEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: expect.objectContaining({ isVoided: true })
        })
      );
    });
  });
});
