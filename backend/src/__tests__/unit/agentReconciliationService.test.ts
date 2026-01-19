import { describe, it, expect, jest } from '@jest/globals';
import agentReconciliationService from '../../services/agentReconciliationService';
import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';

// Mock prisma and dependecies
jest.mock('../../utils/prisma', () => ({
    __esModule: true,
    default: {
        $transaction: jest.fn(),
        agentCollection: {
            findUnique: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
        },
        user: {
            update: jest.fn(),
        },
        agentBalance: {
            findUnique: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
            findMany: jest.fn(),
        },
        agentDeposit: {
            findUnique: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
            findMany: jest.fn(),
        },
        journalEntry: {
            create: jest.fn(),
        },
        account: {
            findUnique: jest.fn(),
        },
        $queryRaw: (jest.fn() as any).mockResolvedValue([]),
    },
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

describe('AgentReconciliationService', () => {
    const mockPrisma = prisma as any;
    const mockTx = {
        agentCollection: mockPrisma.agentCollection,
        user: mockPrisma.user,
        agentBalance: mockPrisma.agentBalance,
        agentDeposit: mockPrisma.agentDeposit,
        journalEntry: mockPrisma.journalEntry,
        account: mockPrisma.account,
        $queryRaw: mockPrisma.$queryRaw,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
        mockTx.$queryRaw.mockResolvedValue([]);
        mockTx.account.findUnique.mockResolvedValue({ id: 10 });
    });

    describe('createDraftCollection', () => {
        it('should create a draft collection', async () => {
            const orderId = 123;
            const agentId = 456;
            const amount = 1000;
            const date = new Date();

            mockTx.agentCollection.create.mockResolvedValue({ id: 1, orderId, agentId, amount, status: 'draft' });

            const result = await agentReconciliationService.createDraftCollection(mockTx as any, orderId, agentId, amount, date);

            expect(mockTx.agentCollection.create).toHaveBeenCalledWith({
                data: {
                    orderId,
                    agentId,
                    amount,
                    status: 'draft',
                    collectionDate: date,
                },
            });
            expect(result.id).toBe(1);
        });
    });

    describe('verifyCollection', () => {
        it('should verify a draft collection and create a GL entry', async () => {
            const collectionId = 1;
            const verifierId = 789;
            const collection = {
                id: collectionId,
                orderId: 123,
                agentId: 456,
                amount: 1000,
                status: 'draft'
            };

            mockTx.agentCollection.findUnique.mockResolvedValue(collection);
            mockTx.agentCollection.update.mockResolvedValue({ ...collection, status: 'verified' });
            mockTx.journalEntry.create.mockResolvedValue({ id: 99 });

            const result = await agentReconciliationService.verifyCollection(collectionId, verifierId);

            expect(mockTx.agentCollection.update).toHaveBeenCalled();
            expect(mockTx.journalEntry.create).toHaveBeenCalled();
            expect(result.status).toBe('verified');
        });

        it('should throw error if collection not found', async () => {
            mockTx.agentCollection.findUnique.mockResolvedValue(null);
            await expect(agentReconciliationService.verifyCollection(999, 1)).rejects.toThrow('Collection record not found');
        });

        it('should throw error if collection is not in draft status', async () => {
            const collection = { id: 1, status: 'verified' };
            mockTx.agentCollection.findUnique.mockResolvedValue(collection);
            await expect(agentReconciliationService.verifyCollection(1, 1)).rejects.toThrow(/Collection cannot be verified/);
        });
    });

    describe('approveCollection', () => {
        it('should approve a verified collection and update agent balance', async () => {
            const collectionId = 1;
            const approverId = 999;
            const collection = {
                id: collectionId,
                agentId: 456,
                amount: 1000,
                status: 'verified'
            };

            const balance = { id: 10, agentId: 456, currentBalance: 0 };

            mockTx.agentCollection.findUnique.mockResolvedValue(collection);
            mockTx.agentCollection.update.mockResolvedValue({ ...collection, status: 'approved' });
            mockTx.agentBalance.findUnique.mockResolvedValue(balance);
            mockTx.agentBalance.update.mockResolvedValue({ ...balance, currentBalance: 1000 });

            const result = await agentReconciliationService.approveCollection(collectionId, approverId);

            expect(mockTx.agentCollection.update).toHaveBeenCalled();
            expect(mockTx.agentBalance.update).toHaveBeenCalledWith({
                where: { id: balance.id },
                data: {
                    totalCollected: { increment: collection.amount },
                    currentBalance: { increment: collection.amount },
                },
            });

            expect(result.status).toBe('approved');
        });
    });

    describe('getOrCreateBalance', () => {
        it('should return existing balance if found', async () => {
            const agentId = 456;
            const balance = { id: 1, agentId };
            mockTx.agentBalance.findUnique.mockResolvedValue(balance);

            const result = await agentReconciliationService.getOrCreateBalance(agentId, mockTx as any);

            expect(result).toEqual(balance);
            expect(mockTx.agentBalance.create).not.toHaveBeenCalled();
        });

        it('should create new balance if not found', async () => {
            const agentId = 456;
            mockTx.agentBalance.findUnique.mockResolvedValue(null);
            mockTx.agentBalance.create.mockResolvedValue({ id: 2, agentId });

            const result = await agentReconciliationService.getOrCreateBalance(agentId, mockTx as any);

            expect(result.id).toBe(2);
            expect(mockTx.agentBalance.create).toHaveBeenCalled();
        });
    });

    describe('verifyDeposit', () => {
        it('should verify deposit and update balance correctly', async () => {
            const depositId = 1;
            const verifierId = 789;
            const deposit = { id: depositId, agentId: 456, amount: 500, status: 'pending' };
            const balance = { id: 10, agentId: 456, currentBalance: 1000 };

            mockTx.agentDeposit.findUnique.mockResolvedValue(deposit);
            mockTx.agentDeposit.update.mockResolvedValue({ ...deposit, status: 'verified' });
            mockTx.agentBalance.findUnique.mockResolvedValue(balance);
            mockTx.journalEntry.create.mockResolvedValue({ id: 99 });

            const result = await agentReconciliationService.verifyDeposit(depositId, verifierId);

            expect(mockTx.agentDeposit.update).toHaveBeenCalledWith({
                where: { id: depositId },
                data: expect.objectContaining({ status: 'verified' }),
            });
            expect(mockTx.agentBalance.update).toHaveBeenCalledWith({
                where: { id: balance.id },
                data: expect.objectContaining({
                    totalDeposited: { increment: deposit.amount },
                    currentBalance: { decrement: deposit.amount },
                }),
            });
            expect(result.status).toBe('verified');
        });

        it('should throw error if deposit amount exceeds current balance', async () => {
            const depositId = 1;
            const deposit = { id: depositId, agentId: 456, amount: 2000, status: 'pending' };
            const balance = { id: 10, agentId: 456, currentBalance: 1000 };

            mockTx.agentDeposit.findUnique.mockResolvedValue(deposit);
            mockTx.agentBalance.findUnique.mockResolvedValue(balance);

            await expect(agentReconciliationService.verifyDeposit(depositId, 1))
                .rejects.toThrow(/Deposit amount exceeds current agent balance/);
        });
    });

    describe('bulkVerifyCollections', () => {
        it('should verify multiple collections successfully', async () => {
            const collectionIds = [1, 2];
            const verifierId = 789;

            const collection1 = { id: 1, orderId: 101, status: 'draft', amount: 1000 };
            const collection2 = { id: 2, orderId: 102, status: 'draft', amount: 2000 };

            mockTx.agentCollection.findUnique
                .mockResolvedValueOnce(collection1)
                .mockResolvedValueOnce(collection2);

            mockTx.agentCollection.update
                .mockResolvedValueOnce({ ...collection1, status: 'verified' })
                .mockResolvedValueOnce({ ...collection2, status: 'verified' });

            mockTx.journalEntry.create.mockResolvedValue({ id: 99 });
            mockTx.account.findUnique.mockResolvedValue({ id: 10 });

            const results = await agentReconciliationService.bulkVerifyCollections(collectionIds, verifierId);

            expect(results).toHaveLength(2);
            expect(results[0].status).toBe('verified');
            expect(results[1].status).toBe('verified');
            expect(mockTx.agentCollection.update).toHaveBeenCalledTimes(2);
        });

        it('should fail entirely if one verification fails (atomicity)', async () => {
            const collectionIds = [1, 2];
            const verifierId = 789;

            const collection1 = { id: 1, orderId: 101, status: 'draft', amount: 1000 };

            mockTx.agentCollection.findUnique
                .mockResolvedValueOnce(collection1)
                .mockResolvedValueOnce(null);

            mockTx.agentCollection.update.mockResolvedValue({ ...collection1, status: 'verified' });
            mockTx.account.findUnique.mockResolvedValue({ id: 10 });

            await expect(agentReconciliationService.bulkVerifyCollections(collectionIds, verifierId))
                .rejects.toThrow('Collection record not found');
        });
    });
});
