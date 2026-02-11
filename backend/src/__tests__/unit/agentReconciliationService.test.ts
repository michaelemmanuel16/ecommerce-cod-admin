import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { Prisma } from '@prisma/client';
import agentReconciliationService from '../../services/agentReconciliationService';
import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';

// Mock appEvents
jest.mock('../../utils/appEvents', () => ({
    __esModule: true,
    default: {
        emit: jest.fn(),
    },
    AppEvent: {
        AGENT_COLLECTION_RECONCILED: 'AGENT_COLLECTION_RECONCILED',
        BULK_ORDERS_IMPORTED: 'BULK_ORDERS_IMPORTED',
        ORDERS_DELETED: 'ORDERS_DELETED',
    },
}));
import appEvents, { AppEvent } from '../../utils/appEvents';

// Mock prisma and dependecies
jest.mock('../../utils/prisma', () => ({
    __esModule: true,
    default: {
        $transaction: jest.fn(),
        agentCollection: {
            findUnique: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
            create: jest.fn(),
            findMany: jest.fn(),
        },
        user: {
            update: jest.fn(),
            findUnique: jest.fn(),
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
            updateMany: jest.fn(),
            create: jest.fn(),
            findMany: jest.fn(),
        },
        journalEntry: {
            create: jest.fn(),
        },
        account: {
            findUnique: jest.fn(),
        },
        order: {
            update: jest.fn(),
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
        createCollectionVerificationEntry: jest.fn().mockImplementation(() => Promise.resolve({} as any)),
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
        order: mockPrisma.order,
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
            mockTx.agentCollection.update.mockResolvedValue({ ...collection, status: 'reconciled' });
            mockTx.agentBalance.findUnique.mockResolvedValue({ id: 10, agentId: 456 });
            mockTx.agentBalance.update.mockResolvedValue({});
            mockTx.user.update.mockResolvedValue({});
            mockTx.journalEntry.create.mockResolvedValue({ id: 99 });

            const result = await agentReconciliationService.verifyCollection(collectionId, verifierId);

            const { GLAutomationService } = require('../../services/glAutomationService');
            expect(mockTx.agentCollection.update).toHaveBeenCalled();
            expect(GLAutomationService.createCollectionVerificationEntry).toHaveBeenCalled();
            expect(result.status).toBe('reconciled');
        });

        it('should throw error if collection not found', async () => {
            mockTx.agentCollection.findUnique.mockResolvedValue(null);
            await expect(agentReconciliationService.verifyCollection(999, 1)).rejects.toThrow('Collection record not found');
        });

        it('should throw error if collection is already reconciled', async () => {
            const collection = { id: 1, status: 'reconciled' };
            mockTx.agentCollection.findUnique.mockResolvedValue(collection);
            await expect(agentReconciliationService.verifyCollection(1, 1)).rejects.toThrow(/Collection cannot be reconciled from status: reconciled/);
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
                    totalDeposited: { increment: collection.amount },
                    currentBalance: { decrement: collection.amount },
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

            // [FIX] Verify FIFO Matching with individual updates (Partial Support)
            expect(mockTx.agentCollection.update).toHaveBeenCalledWith({
                where: { id: 101 },
                data: { status: 'deposited', allocatedAmount: expect.any(Prisma.Decimal) }
            });
            expect(mockTx.agentCollection.update).toHaveBeenCalledWith({
                where: { id: 102 },
                data: { status: 'deposited', allocatedAmount: expect.any(Prisma.Decimal) }
            });

            expect(result.status).toBe('verified');
        });

        it('should perform partial allocation when deposit amount is less than collection outstanding', async () => {
            const depositId = 1;
            const agentId = 456;
            const deposit = { id: depositId, agentId, amount: 500, status: 'pending' };
            const balance = { id: 10, agentId, currentBalance: 1000 };
            const collections = [
                { id: 101, agentId, amount: 1000, allocatedAmount: 0, status: 'approved', collectionDate: new Date() }
            ];

            mockTx.agentDeposit.findUnique.mockResolvedValue(deposit);
            mockTx.agentDeposit.update.mockResolvedValue({ ...deposit, status: 'verified' });
            mockTx.agentBalance.findUnique.mockResolvedValue(balance);
            mockTx.agentCollection.findMany.mockResolvedValue(collections);

            await agentReconciliationService.verifyDeposit(depositId, 789);

            // Verify partial update
            const updateCall = mockTx.agentCollection.update.mock.calls.find((call: any) => call[0].where.id === 101);
            expect(updateCall[0].data.allocatedAmount.toString()).toBe('500');

            // Should NOT be marked as deposited
            expect(updateCall[0].data.status).toBeUndefined();
        });

        it('should handle multiple deposits covering one collection fully', async () => {
            const agentId = 456;
            const balance = { id: 10, agentId, currentBalance: 1000 };

            // First deposit (partial)
            const dep1 = { id: 1, agentId, amount: 400, status: 'pending' };
            const coll = { id: 101, agentId, amount: 1000, allocatedAmount: 0, status: 'approved', collectionDate: new Date() };

            mockTx.agentDeposit.findUnique.mockResolvedValue(dep1);
            mockTx.agentDeposit.update.mockResolvedValue({ ...dep1, status: 'verified' });
            mockTx.agentBalance.findUnique.mockResolvedValue(balance);
            mockTx.agentCollection.findMany.mockResolvedValue([coll]);

            await agentReconciliationService.verifyDeposit(1, 789);

            const firstUpdate = mockTx.agentCollection.update.mock.calls.find((call: any) => call[0].where.id === 101);
            expect(firstUpdate[0].data.allocatedAmount.toString()).toBe('400');

            // Second deposit (completes it)
            const dep2 = { id: 2, agentId, amount: 600, status: 'pending' };
            const partiallyAllocatedColl = { ...coll, allocatedAmount: 400 };

            mockTx.agentDeposit.findUnique.mockResolvedValue(dep2);
            mockTx.agentDeposit.update.mockResolvedValue({ ...dep2, status: 'verified' });
            mockTx.agentCollection.findMany.mockResolvedValue([partiallyAllocatedColl]);

            await agentReconciliationService.verifyDeposit(2, 789);

            const secondUpdate = mockTx.agentCollection.update.mock.calls.find((call: any) =>
                call[0].where.id === 101 && call[0].data.status === 'deposited'
            );
            expect(secondUpdate[0].data.allocatedAmount.toString()).toBe('1000');
            expect(secondUpdate[0].data.status).toBe('deposited');
        });

        it('should handle unallocated remainder by updating deposit notes', async () => {
            const depositId = 1;
            const verifierId = 789;
            const agentId = 456;
            // Deposit is 1000, but only 400 is matched
            const deposit = { id: depositId, agentId, amount: 1000, status: 'pending', referenceNumber: 'DEP456', notes: 'Initial note' };
            const balance = { id: 10, agentId, currentBalance: 2000 };
            const collections = [
                { id: 101, agentId, amount: 400, allocatedAmount: 0, status: 'approved', collectionDate: new Date() }
            ];

            mockTx.agentDeposit.findUnique.mockResolvedValue(deposit);
            mockTx.agentDeposit.update.mockResolvedValue({ ...deposit, status: 'verified' });
            mockTx.agentBalance.findUnique.mockResolvedValue(balance);
            mockTx.agentCollection.findMany.mockResolvedValue(collections);

            await agentReconciliationService.verifyDeposit(depositId, verifierId);

            // Check if update was called to add unallocated remainder note
            expect(mockTx.agentDeposit.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: depositId },
                data: expect.objectContaining({
                    notes: expect.stringContaining('Unallocated remainder: 600')
                })
            }));
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
                .mockResolvedValueOnce({ ...collection1, status: 'reconciled' })
                .mockResolvedValueOnce({ ...collection2, status: 'reconciled' });

            mockTx.journalEntry.create.mockResolvedValue({ id: 99 });
            mockTx.account.findUnique.mockResolvedValue({ id: 10 });

            mockTx.agentBalance.findUnique.mockResolvedValue({ id: 10, agentId: 456 });
            mockTx.agentBalance.update.mockResolvedValue({});
            mockTx.user.update.mockResolvedValue({});

            const results = await agentReconciliationService.bulkVerifyCollections(collectionIds, verifierId);

            expect(results).toHaveLength(2);
            expect(results[0].status).toBe('reconciled');
            expect(results[1].status).toBe('reconciled');
            expect(mockTx.agentCollection.update).toHaveBeenCalledTimes(2);
        });

        it('should fail entirely if one verification fails (atomicity)', async () => {
            const collectionIds = [1, 2];
            const verifierId = 789;

            const collection1 = { id: 1, orderId: 101, status: 'draft', amount: 1000 };

            mockTx.agentCollection.findUnique
                .mockResolvedValueOnce(collection1)
                .mockResolvedValueOnce(null);

            mockTx.agentCollection.update.mockResolvedValue({ ...collection1, status: 'reconciled' });
            mockTx.agentBalance.findUnique.mockResolvedValue({ id: 10, agentId: 456 });
            mockTx.agentBalance.update.mockResolvedValue({});
            mockTx.user.update.mockResolvedValue({});
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

    describe('bulkVerifyDeposits', () => {
        const verifierId = 789;
        const agentId = 456;
        const balance = { id: 10, agentId, currentBalance: 5000 };

        beforeEach(() => {
            mockTx.agentBalance.findUnique.mockResolvedValue(balance);
            mockTx.agentBalance.update.mockResolvedValue({});
            mockTx.agentCollection.findMany.mockResolvedValue([]);
            mockTx.user.findUnique.mockResolvedValue({ id: agentId, firstName: 'Test', lastName: 'Agent' });
        });

        it('should verify multiple deposits successfully', async () => {
            const depositIds = [1, 2, 3];
            const mockDeposits = [
                { id: 1, agentId, amount: 1000, status: 'pending', referenceNumber: 'REF1' },
                { id: 2, agentId, amount: 1000, status: 'pending', referenceNumber: 'REF2' },
                { id: 3, agentId, amount: 1000, status: 'pending', referenceNumber: 'REF3' },
            ];

            mockTx.agentDeposit.findMany.mockResolvedValue(mockDeposits);
            mockTx.agentDeposit.update.mockResolvedValue({});

            const result = await agentReconciliationService.bulkVerifyDeposits(depositIds, verifierId);

            expect(result.verified).toBe(3);
            expect(result.totalAmount).toBe(3000);
            expect(mockTx.agentDeposit.update).toHaveBeenCalledTimes(3);
            expect(mockTx.agentBalance.update).toHaveBeenCalledTimes(1); // One update per agent
        });

        it('should handle exactly 50 deposits', async () => {
            const depositIds = Array.from({ length: 50 }, (_, i) => i + 1);
            const mockDeposits = depositIds.map(id => ({
                id, agentId, amount: 10, status: 'pending', referenceNumber: `REF${id}`
            }));

            mockTx.agentDeposit.findMany.mockResolvedValue(mockDeposits);
            mockTx.agentDeposit.update.mockResolvedValue({});

            const result = await agentReconciliationService.bulkVerifyDeposits(depositIds, verifierId);

            expect(result.verified).toBe(50);
            expect(mockTx.agentDeposit.update).toHaveBeenCalledTimes(50);
        });

        it('should throw error if more than 50 deposits provided', async () => {
            const depositIds = Array.from({ length: 51 }, (_, i) => i + 1);
            await expect(agentReconciliationService.bulkVerifyDeposits(depositIds, verifierId))
                .rejects.toThrow('Cannot verify more than 50 deposits at once');
        });

        it('should throw error if agent has insufficient balance', async () => {
            const depositIds = [1, 2];
            const mockDeposits = [
                { id: 1, agentId, amount: 3000, status: 'pending', referenceNumber: 'REF1' },
                { id: 2, agentId, amount: 3000, status: 'pending', referenceNumber: 'REF2' },
            ]; // Total 6000, balance is 5000

            mockTx.agentDeposit.findMany.mockResolvedValue(mockDeposits);

            await expect(agentReconciliationService.bulkVerifyDeposits(depositIds, verifierId))
                .rejects.toThrow(/insufficient balance/);
        });

        it('should throw error if any deposit is not found', async () => {
            const depositIds = [1, 2];
            mockTx.agentDeposit.findMany.mockResolvedValue([{ id: 1, agentId, amount: 100, status: 'pending' }]);

            await expect(agentReconciliationService.bulkVerifyDeposits(depositIds, verifierId))
                .rejects.toThrow('One or more deposit records not found');
        });

        it('should throw error if any deposit is already verified', async () => {
            const depositIds = [1, 2];
            mockTx.agentDeposit.findMany.mockResolvedValue([
                { id: 1, agentId, amount: 100, status: 'verified', referenceNumber: 'REF1' },
                { id: 2, agentId, amount: 100, status: 'pending', referenceNumber: 'REF2' }
            ]);

            await expect(agentReconciliationService.bulkVerifyDeposits(depositIds, verifierId))
                .rejects.toThrow(/Cannot verify deposits with non - pending status/);
        });

        it('should verify deposits from multiple agents successfully', async () => {
            const agent1Id = 456;
            const agent2Id = 457;
            const depositIds = [1, 2];
            const mockDeposits = [
                { id: 1, agentId: agent1Id, amount: 1000, status: 'pending', referenceNumber: 'REF1' },
                { id: 2, agentId: agent2Id, amount: 1000, status: 'pending', referenceNumber: 'REF2' }
            ];

            mockTx.agentDeposit.findMany.mockResolvedValue(mockDeposits);
            mockTx.agentBalance.findUnique
                .mockResolvedValueOnce({ id: 10, agentId: agent1Id, currentBalance: 5000 })
                .mockResolvedValueOnce({ id: 11, agentId: agent2Id, currentBalance: 5000 });
            mockTx.user.findUnique
                .mockResolvedValueOnce({ id: agent1Id, firstName: 'Agent', lastName: 'One' })
                .mockResolvedValueOnce({ id: agent2Id, firstName: 'Agent', lastName: 'Two' });

            const result = await agentReconciliationService.bulkVerifyDeposits(depositIds, verifierId);

            expect(result.verified).toBe(2);
            expect(mockTx.agentBalance.update).toHaveBeenCalledTimes(2); // One update per agent
        });

        it('should emit AGENT_COLLECTION_RECONCILED event after bulk verification', async () => {
            const depositIds = [1];
            mockTx.agentDeposit.findMany.mockResolvedValue([
                { id: 1, agentId: 456, amount: 1000, status: 'pending', referenceNumber: 'REF1' }
            ]);

            await agentReconciliationService.bulkVerifyDeposits(depositIds, verifierId);

            expect(appEvents.emit).toHaveBeenCalledWith(AppEvent.AGENT_COLLECTION_RECONCILED);
        });

        it('should handle partial matching in FIFO logic', async () => {
            const depositIds = [1];
            const mockDeposits = [
                { id: 1, agentId, amount: 500, status: 'pending', referenceNumber: 'REF1' }
            ];
            const mockCollections = [
                { id: 101, agentId, amount: 1000, status: 'approved', allocatedAmount: 0 }
            ];

            mockTx.agentDeposit.findMany.mockResolvedValue(mockDeposits);
            mockTx.agentCollection.findMany.mockResolvedValue(mockCollections);
            mockTx.agentCollection.update.mockResolvedValue({});

            await agentReconciliationService.bulkVerifyDeposits(depositIds, verifierId);

            expect(mockTx.agentCollection.update).toHaveBeenCalledWith({
                where: { id: 101 },
                data: {
                    allocatedAmount: expect.any(Prisma.Decimal)
                }
            });
            // Verify it didn't set status to 'deposited' since it's only partial
            const updateArgs = mockTx.agentCollection.update.mock.calls[0][0];
            expect(updateArgs.data.status).toBeUndefined();
        });

        it('should handle no pending collections', async () => {
            const depositIds = [1];
            mockTx.agentDeposit.findMany.mockResolvedValue([
                { id: 1, agentId, amount: 1000, status: 'pending', referenceNumber: 'REF1' }
            ]);
            mockTx.agentCollection.findMany.mockResolvedValue([]);

            await agentReconciliationService.bulkVerifyDeposits(depositIds, verifierId);

            expect(mockTx.agentCollection.update).not.toHaveBeenCalled();
        });
    });
});
