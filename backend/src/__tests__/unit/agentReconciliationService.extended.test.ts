/**
 * Extended AgentReconciliationService tests for branch coverage
 * Covers missing branches in createDeposit, rejectDeposit, verifyDeposit,
 * verifyCollectionInternal, bulkVerifyDeposits, blockAgent, getOrCreateBalance
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Prisma } from '@prisma/client';
import agentReconciliationService from '../../services/agentReconciliationService';
import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';

jest.mock('../../utils/appEvents', () => ({
  __esModule: true,
  default: { emit: jest.fn() },
  AppEvent: { AGENT_COLLECTION_RECONCILED: 'AGENT_COLLECTION_RECONCILED' },
}));

jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
    agentCollection: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    user: { update: jest.fn(), findUnique: jest.fn() },
    agentBalance: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), findMany: jest.fn(), upsert: jest.fn() },
    agentDeposit: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    journalEntry: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    account: { findUnique: jest.fn() },
    order: { update: jest.fn(), count: jest.fn() },
    $queryRaw: (jest.fn() as any).mockResolvedValue([]),
  },
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

jest.mock('../../services/notificationService', () => ({
  notifyAgentBlocked: jest.fn(),
  notifyAgentUnblocked: jest.fn(),
}));

jest.mock('../../services/glAutomationService', () => ({
  GLAutomationService: {
    createAgentDepositEntry: jest.fn().mockResolvedValue({} as any),
    createCollectionVerificationEntry: jest.fn().mockResolvedValue({} as any),
  },
}));

describe('AgentReconciliationService (extended branch coverage)', () => {
  const mockPrisma = prisma as any;
  const mockTx = {
    agentCollection: mockPrisma.agentCollection,
    user: mockPrisma.user,
    agentBalance: mockPrisma.agentBalance,
    agentDeposit: mockPrisma.agentDeposit,
    journalEntry: mockPrisma.journalEntry,
    account: mockPrisma.account,
    order: mockPrisma.order,
    $queryRaw: mockPrisma.$queryRaw,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
  });

  // ───────────────────────────── createDeposit - amount <= 0 ─────────────────────────────
  describe('createDeposit - amount validation', () => {
    it('throws 400 when amount is 0', async () => {
      await expect(agentReconciliationService.createDeposit(1, 0, 'cash', 'REF1'))
        .rejects.toThrow(AppError);
    });

    it('throws 400 when amount is negative', async () => {
      await expect(agentReconciliationService.createDeposit(1, -100, 'cash', 'REF1'))
        .rejects.toThrow(AppError);
    });
  });

  // ───────────────────────────── rejectDeposit - note branches ─────────────────────────────
  describe('rejectDeposit - notes branches', () => {
    it('rejects deposit without notes (notes param undefined)', async () => {
      const deposit = { id: 1, agentId: 1, amount: 100, status: 'pending', notes: 'existing note' };
      mockTx.agentDeposit.findUnique.mockResolvedValue(deposit as any);
      mockTx.agentDeposit.update.mockResolvedValue({ ...deposit, status: 'rejected' } as any);

      const result = await agentReconciliationService.rejectDeposit(1, 99);
      expect(result.status).toBe('rejected');
    });

    it('rejects deposit when existing deposit.notes is null', async () => {
      const deposit = { id: 1, agentId: 1, amount: 100, status: 'pending', notes: null };
      mockTx.agentDeposit.findUnique.mockResolvedValue(deposit as any);
      mockTx.agentDeposit.update.mockResolvedValue({ ...deposit, status: 'rejected' } as any);

      // Pass notes param so it takes the truthy branch with null existing notes
      await agentReconciliationService.rejectDeposit(1, 99, 'Fraudulent');
      expect(mockTx.agentDeposit.update).toHaveBeenCalled();
    });

    it('throws 400 when deposit is not in pending status', async () => {
      mockTx.agentDeposit.findUnique.mockResolvedValue({ id: 1, status: 'verified' } as any);
      await expect(agentReconciliationService.rejectDeposit(1, 99))
        .rejects.toThrow(AppError);
    });
  });

  // ───────────────────────────── verifyDeposit - unallocated remainder with null notes ─────────────────────────────
  describe('verifyDeposit - remainder note branches', () => {
    it('updates deposit notes when unallocated remainder and deposit.notes is null', async () => {
      const depositId = 1;
      const deposit = { id: depositId, agentId: 456, amount: 1000, status: 'pending', notes: null };
      const balance = { id: 10, agentId: 456, currentBalance: 2000 };
      // Collection only covers 400, leaving 600 unallocated
      const collections = [
        { id: 101, agentId: 456, amount: 400, allocatedAmount: null, status: 'approved', collectionDate: new Date() }
      ];

      mockTx.agentDeposit.findUnique.mockResolvedValue(deposit as any);
      mockTx.agentDeposit.update.mockResolvedValue({ ...deposit, status: 'verified' } as any);
      mockTx.agentBalance.findUnique.mockResolvedValue(balance as any);
      mockTx.agentCollection.findMany.mockResolvedValue(collections as any);
      mockTx.agentCollection.update.mockResolvedValue({} as any);
      mockTx.agentBalance.update.mockResolvedValue({} as any);

      await agentReconciliationService.verifyDeposit(depositId, 789);

      // Should use null-notes path: `Unallocated remainder: ...`
      const call = (mockTx.agentDeposit.update.mock.calls as any[]).find((c: any) =>
        c[0]?.data?.notes?.includes('Unallocated remainder')
      );
      expect(call).toBeDefined();
    });

    it('skips unallocated remainder note when FIFO fully allocates deposit', async () => {
      const deposit = { id: 1, agentId: 456, amount: 500, status: 'pending', notes: null };
      const balance = { id: 10, agentId: 456, currentBalance: 1000 };
      // Collection is exactly 500 - fully allocated
      const collections = [
        { id: 101, agentId: 456, amount: 500, allocatedAmount: null, status: 'approved', collectionDate: new Date() }
      ];

      mockTx.agentDeposit.findUnique.mockResolvedValue(deposit as any);
      mockTx.agentDeposit.update.mockResolvedValue({ ...deposit, status: 'verified' } as any);
      mockTx.agentBalance.findUnique.mockResolvedValue(balance as any);
      mockTx.agentCollection.findMany.mockResolvedValue(collections as any);
      mockTx.agentCollection.update.mockResolvedValue({} as any);
      mockTx.agentBalance.update.mockResolvedValue({} as any);

      await agentReconciliationService.verifyDeposit(1, 789);

      // Should NOT update notes for unallocated
      const noteCall = (mockTx.agentDeposit.update.mock.calls as any[]).find((c: any) =>
        c[0]?.data?.notes?.includes('Unallocated')
      );
      expect(noteCall).toBeUndefined();
    });
  });

  // ───────────────────────────── verifyCollectionInternal - orderId null ─────────────────────────────
  describe('verifyCollection - orderId null branch', () => {
    it('skips order update when collection.orderId is null', async () => {
      const collection = { id: 1, orderId: null, agentId: 456, amount: 500, status: 'draft', verifiedAt: null, verifiedById: null };
      mockTx.agentCollection.findUnique.mockResolvedValue(collection as any);
      mockTx.agentCollection.update.mockResolvedValue({ ...collection, status: 'reconciled' } as any);
      mockTx.agentBalance.findUnique.mockResolvedValue({ id: 10, agentId: 456 } as any);
      mockTx.agentBalance.update.mockResolvedValue({} as any);
      mockTx.user.update.mockResolvedValue({} as any);

      await agentReconciliationService.verifyCollection(1, 99);

      // order.update should NOT have been called
      expect(mockTx.order.update).not.toHaveBeenCalled();
    });

    it('skips GL entry when collection.status is already verified', async () => {
      const collection = { id: 1, orderId: 100, agentId: 456, amount: 500, status: 'verified', verifiedAt: new Date(), verifiedById: 10 };
      mockTx.agentCollection.findUnique.mockResolvedValue(collection as any);
      mockTx.agentCollection.update.mockResolvedValue({ ...collection, status: 'reconciled' } as any);
      mockTx.agentBalance.findUnique.mockResolvedValue({ id: 10, agentId: 456 } as any);
      mockTx.agentBalance.update.mockResolvedValue({} as any);
      mockTx.user.update.mockResolvedValue({} as any);
      mockTx.order.update.mockResolvedValue({} as any);

      await agentReconciliationService.verifyCollection(1, 99);

      const { GLAutomationService } = require('../../services/glAutomationService');
      // GL entry should NOT be created (status was 'verified', not 'draft')
      expect(GLAutomationService.createCollectionVerificationEntry).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────── bulkVerifyDeposits - empty array ─────────────────────────────
  describe('bulkVerifyDeposits - empty array', () => {
    it('throws 400 when no deposit IDs provided', async () => {
      await expect(agentReconciliationService.bulkVerifyDeposits([], 99))
        .rejects.toThrow(AppError);
    });
  });

  // ───────────────────────────── blockAgent - active deliveries ─────────────────────────────
  describe('blockAgent - active deliveries warning', () => {
    it('logs warning when agent has active deliveries', async () => {
      const balance = { id: 1, agentId: 1, isBlocked: false };
      mockTx.agentBalance.findUnique.mockResolvedValue(balance as any);
      mockTx.order.count.mockResolvedValue(3); // has active deliveries
      mockTx.agentBalance.update.mockResolvedValue({ ...balance, isBlocked: true } as any);

      await agentReconciliationService.blockAgent(1, 99, 'test');
      expect(mockTx.order.count).toHaveBeenCalled();
    });
  });

  // ───────────────────────────── getOrCreateBalance - no tx ─────────────────────────────
  describe('getOrCreateBalance - without tx', () => {
    it('uses prisma directly when no tx provided', async () => {
      const balance = { id: 1, agentId: 42 };
      mockPrisma.agentBalance.findUnique.mockResolvedValue(balance as any);

      const result = await agentReconciliationService.getOrCreateBalance(42);
      expect(result).toEqual(balance);
    });
  });
});
