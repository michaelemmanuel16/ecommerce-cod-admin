import { describe, it, expect, jest, beforeEach } from '@jest/globals';
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
            findMany: jest.fn(),
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

jest.mock('../../services/notificationService', () => ({
    notifyAgentBlocked: jest.fn(),
    notifyAgentUnblocked: jest.fn(),
}));

jest.mock('../../utils/socketInstance', () => ({
    getSocketInstance: jest.fn(),
}));

jest.mock('../../services/glAutomationService', () => ({
    GLAutomationService: {
        createAgentDepositEntry: jest.fn().mockImplementation(() => Promise.resolve({} as any)),
    },
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

    describe('createDeposit', () => {
        it('should create a pending deposit when amount is valid and within balance', async () => {
            const agentId = 456;
            const amount = 500;
            const balance = { id: 10, agentId, currentBalance: 1000 };

            mockTx.agentBalance.findUnique.mockResolvedValue(balance);
            mockTx.agentDeposit.create.mockResolvedValue({
                id: 1,
                agentId,
                amount,
                status: 'pending',
                depositMethod: 'bank_transfer',
                referenceNumber: 'REF123'
            });

            const result = await agentReconciliationService.createDeposit(agentId, amount, 'bank_transfer', 'REF123');

            expect(mockTx.agentDeposit.create).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({
                    amount,
                    depositMethod: 'bank_transfer',
                    referenceNumber: 'REF123'
                })
            }));
            expect(result.id).toBe(1);
        });

        it('should throw error if deposit amount exceeds current balance', async () => {
            const agentId = 456;
            const amount = 2000;
            const balance = { id: 10, agentId, currentBalance: 1000 };

            mockTx.agentBalance.findUnique.mockResolvedValue(balance);

            await expect(agentReconciliationService.createDeposit(agentId, amount, 'cash', 'REF456'))
                .rejects.toThrow(/Deposit amount cannot exceed your current outstanding balance/);
        });
    });

    describe('verifyDeposit', () => {
        it('should verify deposit, update balance, and perform FIFO matching to collections', async () => {
            const depositId = 1;
            const verifierId = 789;
            const agentId = 456;
            const deposit = { id: depositId, agentId, amount: 1500, status: 'pending', referenceNumber: 'DEP123' };
            const balance = { id: 10, agentId, currentBalance: 2000 };

            const collections = [
                { id: 101, agentId, amount: 1000, status: 'approved', collectionDate: new Date('2024-01-01') },
                { id: 102, agentId, amount: 500, status: 'approved', collectionDate: new Date('2024-01-02') },
                { id: 103, agentId, amount: 1000, status: 'approved', collectionDate: new Date('2024-01-03') },
            ];

            mockTx.agentDeposit.findUnique.mockResolvedValue(deposit);
            mockTx.agentDeposit.update.mockResolvedValue({ ...deposit, status: 'verified' });
            mockTx.agentBalance.findUnique.mockResolvedValue(balance);
            mockTx.agentCollection.findMany.mockResolvedValue(collections);

            const result = await agentReconciliationService.verifyDeposit(depositId, verifierId);

            expect(mockTx.agentDeposit.update).toHaveBeenCalled();
            expect(mockTx.agentBalance.update).toHaveBeenCalled();

            // Verify FIFO Matching
            // Deposit amount is 1500. 
            // Collection 101 (1000) should be 'deposited'
            // Collection 102 (500) should be 'deposited'
            // Collection 103 (1000) should NOT be updated
            expect(mockTx.agentCollection.update).toHaveBeenCalledTimes(2);
            expect(mockTx.agentCollection.update).toHaveBeenCalledWith({
                where: { id: 101 },
                data: { status: 'deposited' }
            });
            expect(mockTx.agentCollection.update).toHaveBeenCalledWith({
                where: { id: 102 },
                data: { status: 'deposited' }
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

    describe('rejectDeposit', () => {
        it('should reject a pending deposit', async () => {
            const depositId = 1;
            const userId = 789;
            const deposit = { id: depositId, agentId: 456, amount: 1000, status: 'pending' };

            mockTx.agentDeposit.findUnique.mockResolvedValue(deposit);
            mockTx.agentDeposit.update.mockResolvedValue({ ...deposit, status: 'rejected' });

            const result = await agentReconciliationService.rejectDeposit(depositId, userId, 'Test rejection');

            expect(mockTx.agentDeposit.update).toHaveBeenCalledWith({
                where: { id: depositId },
                data: expect.objectContaining({
                    status: 'rejected',
                    verifiedById: userId,
                }),
            });
            expect(result.status).toBe('rejected');
            // Agent balance should NOT be updated
            expect(mockTx.agentBalance.update).not.toHaveBeenCalled();
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
    describe('blockAgent', () => {
        it('should block an agent and record audit info', async () => {
            const agentId = 456;
            const userId = 1;
            const reason = 'Test block';
            const balance = { id: 1, agentId, isBlocked: false };

            mockTx.agentBalance.findUnique.mockResolvedValue(balance);
            mockTx.agentBalance.update.mockResolvedValue({
                ...balance,
                isBlocked: true,
                blockReason: reason,
                blockedAt: new Date(),
                blockedById: userId
            });

            const result = await agentReconciliationService.blockAgent(agentId, userId, reason);

            expect(mockTx.agentBalance.update).toHaveBeenCalledWith({
                where: { id: balance.id },
                data: expect.objectContaining({
                    isBlocked: true,
                    blockReason: reason,
                    blockedById: userId
                }),
                include: expect.any(Object)
            });
            expect(result.isBlocked).toBe(true);
        });
    });

    describe('unblockAgent', () => {
        it('should unblock a blocked agent', async () => {
            const agentId = 456;
            const userId = 1;
            const balance = { id: 1, agentId, isBlocked: true };

            mockTx.agentBalance.findUnique.mockResolvedValue(balance);
            mockTx.agentBalance.update.mockResolvedValue({
                ...balance,
                isBlocked: false,
                blockReason: null,
                blockedAt: null,
                blockedById: null
            });

            const result = await agentReconciliationService.unblockAgent(agentId, userId);

            expect(mockTx.agentBalance.update).toHaveBeenCalledWith({
                where: { id: balance.id },
                data: expect.objectContaining({
                    isBlocked: false,
                    blockReason: null
                }),
                include: expect.any(Object)
            });
            expect(result.isBlocked).toBe(false);
        });

        it('should throw error if agent is not blocked', async () => {
            const balance = { id: 1, agentId: 456, isBlocked: false };
            mockTx.agentBalance.findUnique.mockResolvedValue(balance);

            await expect(agentReconciliationService.unblockAgent(456, 1))
                .rejects.toThrow('Agent is not currently blocked');
        });
    });

    describe('getBlockedAgents', () => {
        it('should return all blocked agents', async () => {
            const blockedAgents = [{ id: 1, isBlocked: true, agent: { firstName: 'Agent' } }];
            mockPrisma.agentBalance.findMany.mockResolvedValue(blockedAgents);

            const result = await agentReconciliationService.getBlockedAgents();

            expect(mockPrisma.agentBalance.findMany).toHaveBeenCalledWith(expect.objectContaining({
                where: { isBlocked: true }
            }));
            expect(result).toEqual(blockedAgents);
        });
    });
});
