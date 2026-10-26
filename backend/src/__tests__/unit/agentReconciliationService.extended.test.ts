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
    agentDeposit: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    journalEntry: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    account: { findUnique: jest.fn() },
    order: { update: jest.fn(), count: jest.fn() },
    finding: { updateMany: jest.fn() },
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
    voidJournalEntry: jest.fn().mockResolvedValue({} as any),
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
    finding: mockPrisma.finding,
    $queryRaw: mockPrisma.$queryRaw,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
    mockTx.agentDeposit.updateMany.mockResolvedValue({ count: 1 }); // the claim of the row
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
      mockTx.agentDeposit.findUnique.mockResolvedValueOnce(deposit as any).mockResolvedValueOnce({ ...deposit, status: 'rejected' } as any);

      const result = await agentReconciliationService.rejectDeposit(1, 99);
      expect(result.status).toBe('rejected');
    });

    it('rejects deposit when existing deposit.notes is null', async () => {
      const deposit = { id: 1, agentId: 1, amount: 100, status: 'pending', notes: null };
      mockTx.agentDeposit.findUnique.mockResolvedValueOnce(deposit as any).mockResolvedValueOnce({ ...deposit, status: 'rejected' } as any);

      // Pass notes param so it takes the truthy branch with null existing notes
      await agentReconciliationService.rejectDeposit(1, 99, 'Fraudulent');
      expect(mockTx.agentDeposit.updateMany).toHaveBeenCalled();
    });

    it('throws 400 when deposit is already rejected', async () => {
      mockTx.agentDeposit.findUnique.mockResolvedValue({ id: 1, status: 'rejected' } as any);
      await expect(agentReconciliationService.rejectDeposit(1, 99))
        .rejects.toThrow(AppError);
    });

    it('a verified deposit is voided by reversal, the balance is restored and only its own matched collections open again (F-904)', async () => {
      const { GLAutomationService } = require('../../services/glAutomationService');
      // 150 deposited: 100 on collection 1 and 50 on collection 2; a later deposit also sits on collection 2 (allocated 80 in all)
      const deposit = { id: 1, agentId: 5, amount: 150, status: 'verified', notes: null, allocations: [{ collectionId: 1, amount: '100' }, { collectionId: 2, amount: '50' }] };
      mockTx.agentDeposit.findUnique.mockResolvedValueOnce(deposit as any).mockResolvedValueOnce({ ...deposit, status: 'rejected' } as any);
      mockTx.agentBalance.findUnique.mockResolvedValue({ id: 10, agentId: 5 } as any);
      mockTx.agentBalance.update.mockResolvedValue({} as any);
      mockTx.agentCollection.findUnique
        .mockResolvedValueOnce({ id: 1, status: 'deposited', amount: 100, allocatedAmount: 100 } as any)
        .mockResolvedValueOnce({ id: 2, status: 'draft', amount: 100, allocatedAmount: 80 } as any);
      mockTx.agentCollection.update.mockResolvedValue({} as any);

      await agentReconciliationService.rejectDeposit(1, 99, 'Receipt is unclear');

      expect(GLAutomationService.voidJournalEntry).toHaveBeenCalledWith(mockTx, 'agent_deposit', 1, 99);
      expect(mockTx.agentBalance.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { totalDeposited: { decrement: 150 }, currentBalance: { increment: 150 } },
      });
      const updates = mockTx.agentCollection.update.mock.calls.map((c: any) => c[0]);
      expect(updates).toHaveLength(2);
      expect(updates[0]).toMatchObject({ where: { id: 1 }, data: { status: 'draft' } });
      expect(Number(updates[0].data.allocatedAmount)).toBe(0);
      expect(updates[1]).toMatchObject({ where: { id: 2 } });
      expect(Number(updates[1].data.allocatedAmount)).toBe(30); // the later deposit's 30 stays
      expect(mockTx.agentDeposit.updateMany.mock.calls[0][0]).toMatchObject({
        where: { id: 1, status: 'verified' }, data: { status: 'rejected', rejectReason: 'Receipt is unclear' },
      });
    });

    it('a reject that loses the claim throws 409 and undoes nothing', async () => {
      const { GLAutomationService } = require('../../services/glAutomationService');
      mockTx.agentDeposit.findUnique.mockResolvedValue({ id: 1, agentId: 5, amount: 150, status: 'verified', allocations: [] } as any);
      mockTx.agentDeposit.updateMany.mockResolvedValue({ count: 0 });
      await expect(agentReconciliationService.rejectDeposit(1, 99)).rejects.toMatchObject({ statusCode: 409 });
      expect(GLAutomationService.voidJournalEntry).not.toHaveBeenCalled();
      expect(mockTx.agentBalance.update).not.toHaveBeenCalled();
    });

    it('a pending deposit is rejected without touching the ledger', async () => {
      const { GLAutomationService } = require('../../services/glAutomationService');
      const deposit = { id: 1, agentId: 5, amount: 150, status: 'pending', notes: null };
      mockTx.agentDeposit.findUnique.mockResolvedValue(deposit as any);
      await agentReconciliationService.rejectDeposit(1, 99);
      expect(GLAutomationService.voidJournalEntry).not.toHaveBeenCalled();
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

    it('posts no GL entry when a verified collection is reconciled (F-904)', async () => {
      const collection = { id: 1, orderId: 100, agentId: 456, amount: 500, status: 'verified', verifiedAt: new Date(), verifiedById: 10 };
      mockTx.agentCollection.findUnique.mockResolvedValue(collection as any);
      mockTx.agentCollection.update.mockResolvedValue({ ...collection, status: 'reconciled' } as any);
      mockTx.agentBalance.findUnique.mockResolvedValue({ id: 10, agentId: 456 } as any);
      mockTx.agentBalance.update.mockResolvedValue({} as any);
      mockTx.user.update.mockResolvedValue({} as any);
      mockTx.order.update.mockResolvedValue({} as any);

      await agentReconciliationService.verifyCollection(1, 99);

      const { GLAutomationService } = require('../../services/glAutomationService');
      // Verifying a collection posts nothing: cash moves 1015 -> 1010 when a deposit is verified
      expect(GLAutomationService.createAgentDepositEntry).not.toHaveBeenCalled();
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
