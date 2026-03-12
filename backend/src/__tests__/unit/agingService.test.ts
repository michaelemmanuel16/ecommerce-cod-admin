import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import agingService from '../../services/agingService';
import prisma from '../../utils/prisma';
import { Prisma } from '@prisma/client';

// Mock prisma
jest.mock('../../utils/prisma', () => ({
    __esModule: true,
    default: {
        agentCollection: {
            findMany: jest.fn(),
        },
        agentAgingBucket: {
            upsert: jest.fn(),
            deleteMany: jest.fn(),
            findMany: jest.fn(),
        },
        $transaction: jest.fn(async (cb: any) => await cb(prisma)),
    },
}));

jest.mock('../../services/agentReconciliationService', () => ({
    __esModule: true,
    default: {
        getAgentBalance: jest.fn(),
        blockAgent: jest.fn(),
    },
}));

jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
}));

describe('AgingService', () => {
    const mockPrisma = prisma as any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.$transaction.mockImplementation(async (cb: any) => await cb(mockPrisma));

        // Use fake timers and set a fixed date: 2026-01-21
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-01-21T12:00:00Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllTimers();
    });

    describe('refreshAll', () => {
        it('should correctly bucket collections by aging', async () => {
            const mockCollections = [
                {
                    agentId: 1,
                    amount: new Prisma.Decimal(1000),
                    collectionDate: new Date('2026-01-21T10:00:00Z'), // 0 days ago (0-1)
                },
                {
                    agentId: 1,
                    amount: new Prisma.Decimal(2000),
                    collectionDate: new Date('2026-01-19T10:00:00Z'), // 2 days ago (2-3)
                },
                {
                    agentId: 1,
                    amount: new Prisma.Decimal(3000),
                    collectionDate: new Date('2026-01-16T10:00:00Z'), // 5 days ago (4-7)
                },
                {
                    agentId: 1,
                    amount: new Prisma.Decimal(4000),
                    collectionDate: new Date('2026-01-10T10:00:00Z'), // 11 days ago (8+)
                },
            ];

            mockPrisma.agentCollection.findMany.mockResolvedValue(mockCollections);
            mockPrisma.agentAgingBucket.upsert.mockResolvedValue({});

            await agingService.refreshAll();

            expect(mockPrisma.agentAgingBucket.upsert).toHaveBeenCalledWith(expect.objectContaining({
                where: { agentId: 1 },
                update: expect.objectContaining({
                    totalBalance: expect.any(Object),
                    bucket_0_1: expect.any(Object),
                    bucket_2_3: expect.any(Object),
                    bucket_4_7: expect.any(Object),
                    bucket_8_plus: expect.any(Object),
                }),
            }));

            const callArgs = mockPrisma.agentAgingBucket.upsert.mock.calls[0][0].update;
            expect(callArgs.totalBalance.toString()).toBe('10000');
            expect(callArgs.bucket_0_1.toString()).toBe('1000');
            expect(callArgs.bucket_2_3.toString()).toBe('2000');
            expect(callArgs.bucket_4_7.toString()).toBe('3000');
            expect(callArgs.bucket_8_plus.toString()).toBe('4000');
        });

        it('should handle multiple agents and clear unused buckets', async () => {
            const mockCollections = [
                { agentId: 1, amount: new Prisma.Decimal(1000), collectionDate: new Date('2026-01-21T10:00:00Z') },
                { agentId: 2, amount: new Prisma.Decimal(500), collectionDate: new Date('2026-01-21T10:00:00Z') },
            ];

            mockPrisma.agentCollection.findMany.mockResolvedValue(mockCollections);

            await agingService.refreshAll();

            expect(mockPrisma.agentAgingBucket.upsert).toHaveBeenCalledTimes(2);
            expect(mockPrisma.agentAgingBucket.deleteMany).toHaveBeenCalledWith({
                where: {
                    agentId: { notIn: [1, 2] }
                }
            });
        });

        it('should handle case with no collections', async () => {
            mockPrisma.agentCollection.findMany.mockResolvedValue([]);

            await agingService.refreshAll();

            expect(mockPrisma.agentAgingBucket.upsert).not.toHaveBeenCalled();
            expect(mockPrisma.agentAgingBucket.deleteMany).toHaveBeenCalledWith({});
        });
    });

    describe('getAgingReport', () => {
        it('should return cached aging data', async () => {
            const mockBuckets = [
                {
                    agentId: 1,
                    totalBalance: new Prisma.Decimal(10000),
                    bucket_0_1: new Prisma.Decimal(1000),
                    bucket_2_3: new Prisma.Decimal(2000),
                    bucket_4_7: new Prisma.Decimal(3000),
                    bucket_8_plus: new Prisma.Decimal(4000),
                    agent: { id: 1, firstName: 'John', lastName: 'Doe', email: 'john@example.com' }
                }
            ];

            mockPrisma.agentAgingBucket.findMany.mockResolvedValue(mockBuckets);
            mockPrisma.agentBalance = {
                count: jest.fn().mockResolvedValue(1),
                findMany: jest.fn().mockResolvedValue([{ agentId: 1, isBlocked: false }]),
            } as any;
            mockPrisma.account = {
                findFirst: jest.fn().mockResolvedValue({ currentBalance: new Prisma.Decimal(10000) }),
            } as any;

            const result = await agingService.getAgingReport();

            expect(result.summary).toBeDefined();
            expect(result.buckets[0].isBlocked).toBe(false);
            expect(result.summary.totalOutstandingAmount).toBe(10000);
            expect(result.summary.bucketTotals.bucket_8_plus).toBe(4000);
            expect(mockPrisma.agentAgingBucket.findMany).toHaveBeenCalledWith({
                include: expect.any(Object),
                orderBy: {
                    bucket_8_plus: 'desc',
                },
            });
        });
    });

    describe('getOverdueAgents', () => {
        it('should return agents with overdue buckets', async () => {
            const mockBuckets = [
                { agentId: 1, totalBalance: new Prisma.Decimal(500), bucket_4_7: new Prisma.Decimal(500), bucket_8_plus: new Prisma.Decimal(0), agent: { id: 1, firstName: 'Agent', lastName: 'One' } },
                { agentId: 2, totalBalance: new Prisma.Decimal(1000), bucket_4_7: new Prisma.Decimal(0), bucket_8_plus: new Prisma.Decimal(1000), agent: { id: 2, firstName: 'Agent', lastName: 'Two' } },
            ];

            mockPrisma.agentAgingBucket.findMany.mockResolvedValue(mockBuckets);

            const result = await agingService.getOverdueAgents();

            expect(result).toHaveLength(2);
            expect(result[0]).toEqual({ agentId: 1, agentName: 'Agent One', totalBalance: 500, warningAmount: 500, criticalAmount: 0 });
            expect(result[1]).toEqual({ agentId: 2, agentName: 'Agent Two', totalBalance: 1000, warningAmount: 0, criticalAmount: 1000 });
        });
    });
});
