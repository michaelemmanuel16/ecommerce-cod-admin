/**
 * Extended GLService tests for branch coverage
 * Focuses on getJournalEntries filters, getJournalEntryById, getAccountBalance, getAccountLedger
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../../server', () => {
  const m = { emit: jest.fn(), to: jest.fn() };
  m.to.mockReturnValue(m);
  return { io: m };
});

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { prismaMock } from '../mocks/prisma.mock';
import glService from '../../services/glService';
import { AppError } from '../../middleware/errorHandler';
import { AccountType, NormalBalance } from '@prisma/client';

const mockEntry = {
  id: 1,
  entryNumber: 'JE-001',
  description: 'Test entry',
  sourceType: 'order',
  sourceId: '1',
  isVoided: false,
  entryDate: new Date(),
  transactions: [],
  creator: { id: 1, firstName: 'Admin', lastName: 'User' },
  voider: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockAccount = {
  id: 1,
  code: '1100',
  name: 'Cash',
  type: 'asset' as AccountType,
  normalBalance: 'debit' as NormalBalance,
  isActive: true,
  isSystem: false,
  parentId: null,
  balance: 0,
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('GLService (extended branch coverage)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────── getJournalEntries ─────────────────────────────
  describe('getJournalEntries - filter branches', () => {
    beforeEach(() => {
      (prismaMock.journalEntry.findMany as any).mockResolvedValue([mockEntry] as any);
      (prismaMock.journalEntry.count as any).mockResolvedValue(1);
    });

    it('returns entries without any filters', async () => {
      const result = await glService.getJournalEntries({});
      expect(result.entries).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('applies sourceType filter', async () => {
      const result = await glService.getJournalEntries({ sourceType: 'order' });
      expect(prismaMock.journalEntry.findMany).toHaveBeenCalled();
    });

    it('applies sourceId filter', async () => {
      const result = await glService.getJournalEntries({ sourceId: '42' });
      expect(prismaMock.journalEntry.findMany).toHaveBeenCalled();
    });

    it('applies isVoided filter', async () => {
      const result = await glService.getJournalEntries({ isVoided: false });
      expect(prismaMock.journalEntry.findMany).toHaveBeenCalled();
    });

    it('applies startDate and endDate filters', async () => {
      const result = await glService.getJournalEntries({
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      });
      expect(prismaMock.journalEntry.findMany).toHaveBeenCalled();
    });

    it('applies only startDate filter', async () => {
      const result = await glService.getJournalEntries({ startDate: '2024-01-01' });
      expect(result).toBeDefined();
    });

    it('applies only endDate filter', async () => {
      const result = await glService.getJournalEntries({ endDate: '2024-12-31' });
      expect(result).toBeDefined();
    });

    it('paginates results correctly', async () => {
      (prismaMock.journalEntry.count as any).mockResolvedValue(100);
      const result = await glService.getJournalEntries({ page: 2, limit: 25 });
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(25);
      expect(result.pagination.total).toBe(100);
      expect(result.pagination.pages).toBe(4);
    });

    it('combines multiple filters', async () => {
      const result = await glService.getJournalEntries({
        sourceType: 'order',
        isVoided: false,
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      });
      expect(result).toBeDefined();
    });
  });

  // ───────────────────────────── getJournalEntryById ─────────────────────────────
  describe('getJournalEntryById', () => {
    it('throws 400 for invalid (non-numeric) entry ID', async () => {
      await expect(glService.getJournalEntryById('abc')).rejects.toThrow(AppError);
    });

    it('throws 404 when entry not found', async () => {
      (prismaMock.journalEntry.findUnique as any).mockResolvedValue(null);
      await expect(glService.getJournalEntryById('999')).rejects.toThrow(AppError);
    });

    it('returns entry when found', async () => {
      (prismaMock.journalEntry.findUnique as any).mockResolvedValue({
        ...mockEntry, transactions: []
      } as any);
      const result = await glService.getJournalEntryById('1');
      expect(result.id).toBe(1);
    });
  });

  // ───────────────────────────── getAccountBalance ─────────────────────────────
  describe('getAccountBalance', () => {
    it('throws 400 for invalid account ID', async () => {
      await expect(glService.getAccountBalance('abc')).rejects.toThrow(AppError);
    });

    it('throws 404 when account not found', async () => {
      (prismaMock.account.findUnique as any).mockResolvedValue(null);
      await expect(glService.getAccountBalance('999')).rejects.toThrow(AppError);
    });

    it('returns account balance when found', async () => {
      (prismaMock.account.findUnique as any).mockResolvedValue({
        ...mockAccount, currentBalance: 5000
      } as any);
      const result = await glService.getAccountBalance('1');
      expect(result.currentBalance).toBe(5000);
    });
  });

  // ───────────────────────────── getAllAccounts - extended filters ─────────────────────────────
  describe('getAllAccounts - extended filter branches', () => {
    const mockAccountWithRelations = { ...mockAccount, parent: null, children: [] };

    beforeEach(() => {
      (prismaMock.account.findMany as any).mockResolvedValue([mockAccountWithRelations] as any);
      (prismaMock.account.count as any).mockResolvedValue(1);
    });

    it('applies isActive filter', async () => {
      const result = await glService.getAllAccounts({ isActive: true });
      expect(prismaMock.account.findMany).toHaveBeenCalled();
    });

    it('applies accountType filter', async () => {
      const result = await glService.getAllAccounts({ accountType: 'asset' as any });
      expect(result.accounts).toBeDefined();
    });

    it('applies date range and computes period activity', async () => {
      (prismaMock.accountTransaction.groupBy as any).mockResolvedValue([
        { accountId: 1, _sum: { debitAmount: 100, creditAmount: 200 } },
      ] as any);

      const result = await glService.getAllAccounts({ startDate: '2024-01-01', endDate: '2024-12-31' });
      expect(result.accounts[0].periodActivity).toBeDefined();
    });

    it('applies only startDate (period activity)', async () => {
      (prismaMock.accountTransaction.groupBy as any).mockResolvedValue([] as any);
      const result = await glService.getAllAccounts({ startDate: '2024-01-01' });
      expect(result.accounts).toBeDefined();
    });

    it('applies only endDate (period activity)', async () => {
      (prismaMock.accountTransaction.groupBy as any).mockResolvedValue([] as any);
      const result = await glService.getAllAccounts({ endDate: '2024-12-31' });
      expect(result.accounts).toBeDefined();
    });

    it('returns null periodActivity when no date filter', async () => {
      const result = await glService.getAllAccounts({});
      expect(result.accounts[0].periodActivity).toBeNull();
    });

    it('returns paginated results', async () => {
      (prismaMock.account.count as any).mockResolvedValue(50);
      const result = await glService.getAllAccounts({ page: 2, limit: 10 });
      expect(result.pagination.pages).toBe(5);
    });
  });

  // ───────────────────────────── deleteAccount - extended ─────────────────────────────
  describe('deleteAccount - with requester', () => {
    it('creates audit log when requester provided', async () => {
      (prismaMock.account.findUnique as any).mockResolvedValue({
        ...mockAccount, isSystem: false, children: []
      } as any);
      (prismaMock.accountTransaction.count as any).mockResolvedValue(0);
      (prismaMock.account.delete as any).mockResolvedValue(mockAccount as any);
      (prismaMock.auditLog.create as any).mockResolvedValue({} as any);

      const result = await glService.deleteAccount('1', { id: 1, role: 'admin', tenantId: 'tenant-1' } as any);
      expect(result).toHaveProperty('message');
    });
  });
});
