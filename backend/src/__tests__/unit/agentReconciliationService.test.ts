import agentReconciliationService from '../../services/agentReconciliationService';
import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';
import { GL_ACCOUNTS } from '../../config/glAccounts';
import { Decimal } from '@prisma/client/runtime/library';

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
        journalEntry: {
            create: jest.fn(),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
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
        journalEntry: mockPrisma.journalEntry,
        $queryRaw: mockPrisma.$queryRaw,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.$transaction.mockImplementation((cb: any) => cb(mockTx));
        mockTx.$queryRaw.mockResolvedValue([]);
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
        it('should approve a verified collection and increment agent balance', async () => {
            const collectionId = 1;
            const approverId = 999;
            const collection = {
                id: collectionId,
                agentId: 456,
                amount: 1000,
                status: 'verified'
            };

            mockTx.agentCollection.findUnique.mockResolvedValue(collection);
            mockTx.agentCollection.update.mockResolvedValue({ ...collection, status: 'approved' });

            const result = await agentReconciliationService.approveCollection(collectionId, approverId);

            expect(mockTx.agentCollection.update).toHaveBeenCalled();
            expect(mockTx.user.update).toHaveBeenCalledWith({
                where: { id: collection.agentId },
                data: {
                    totalCollected: {
                        increment: collection.amount,
                    },
                },
            });

            expect(result.status).toBe('approved');
        });
    });
});
