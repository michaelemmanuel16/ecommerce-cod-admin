/**
 * Extended AgingService tests for branch coverage
 * Covers: agentIds.length === 0 in getAgingReport, no-overdue branch in getAgingSummary,
 * oldestCollectionDate not updated (newer collection), generateAgingCSV
 */
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import agingService from '../../services/agingService';
import prisma from '../../utils/prisma';
import { Prisma } from '@prisma/client';

jest.mock('../../utils/prisma', () => ({
  __esModule: true,
  default: {
    agentCollection: { findMany: jest.fn() },
    agentAgingBucket: { upsert: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
    agentBalance: { count: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('../../utils/logger', () => ({
  info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(),
}));

describe('AgingService (extended branch coverage)', () => {
  const mockPrisma = prisma as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => await cb(mockPrisma));
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-21T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ───────────────────────────── getAgingReport - no buckets ─────────────────────────────
  describe('getAgingReport - no buckets (agentIds.length === 0)', () => {
    it('returns empty buckets without querying agentBalance when no buckets exist', async () => {
      mockPrisma.agentAgingBucket.findMany.mockResolvedValue([]);
      mockPrisma.agentBalance.count.mockResolvedValue(0);

      const result = await agingService.getAgingReport();
      expect(result.buckets).toHaveLength(0);
      // agentBalance.findMany should NOT be called when agentIds is empty
      expect(mockPrisma.agentBalance.findMany).not.toHaveBeenCalled();
    });
  });

  // ───────────────────────────── getAgingSummary - no overdue agents ─────────────────────────────
  describe('getAgingSummary - no overdue agents branch', () => {
    it('does not increment overdueAgentsCount when bucket has no critical or warning amounts', async () => {
      const buckets = [{
        agentId: 1,
        totalBalance: new Prisma.Decimal(1000),
        bucket_0_1: new Prisma.Decimal(1000),
        bucket_2_3: new Prisma.Decimal(0),
        bucket_4_7: new Prisma.Decimal(0),   // no warning
        bucket_8_plus: new Prisma.Decimal(0), // no critical
        agent: { id: 1, firstName: 'John', lastName: 'Doe', email: 'john@test.com' },
      }];
      mockPrisma.agentAgingBucket.findMany.mockResolvedValue(buckets);
      mockPrisma.agentBalance.findMany.mockResolvedValue([{ agentId: 1, isBlocked: false }]);
      mockPrisma.agentBalance.count.mockResolvedValue(0);

      const result = await agingService.getAgingReport();
      expect(result.summary.overdueAgentsCount).toBe(0);
    });
  });

  // ───────────────────────────── refreshAll - oldestCollectionDate not updated ─────────────────────────────
  describe('refreshAll - oldestCollectionDate false branch', () => {
    it('does not update oldestCollectionDate when new collection is newer', async () => {
      // Collections for same agent: oldest first (2026-01-10), then newer (2026-01-21)
      // When processing newer collection, collectionDate < oldestCollectionDate = FALSE
      const collections = [
        { agentId: 1, amount: new Prisma.Decimal(1000), collectionDate: new Date('2026-01-10T10:00:00Z') }, // older (11 days)
        { agentId: 1, amount: new Prisma.Decimal(500), collectionDate: new Date('2026-01-21T10:00:00Z') }, // newer (0 days) - should NOT update oldest
      ];
      mockPrisma.agentCollection.findMany.mockResolvedValue(collections);
      mockPrisma.agentAgingBucket.upsert.mockResolvedValue({});
      mockPrisma.agentAgingBucket.deleteMany.mockResolvedValue({});

      await agingService.refreshAll();

      // Upsert should have the oldest date as Jan 10
      const upsertCall = mockPrisma.agentAgingBucket.upsert.mock.calls[0][0];
      expect(upsertCall.update.oldestCollectionDate).toEqual(new Date('2026-01-10T10:00:00Z'));
    });
  });

  // ───────────────────────────── generateAgingCSV ─────────────────────────────
  describe('generateAgingCSV', () => {
    it('generates CSV with agent data (oldestCollectionDate has value)', async () => {
      const buckets = [{
        agentId: 1,
        totalBalance: new Prisma.Decimal(1000),
        bucket_0_1: new Prisma.Decimal(500),
        bucket_2_3: new Prisma.Decimal(200),
        bucket_4_7: new Prisma.Decimal(200),
        bucket_8_plus: new Prisma.Decimal(100),
        oldestCollectionDate: new Date('2026-01-10'),
        agent: { id: 1, firstName: 'John', lastName: 'Doe', email: 'j@test.com' },
      }];
      mockPrisma.agentAgingBucket.findMany.mockResolvedValue(buckets);
      mockPrisma.agentBalance.findMany.mockResolvedValue([]);
      mockPrisma.agentBalance.count.mockResolvedValue(0);

      const csv = await agingService.generateAgingCSV();
      expect(csv).toContain('John Doe');
      expect(csv).toContain('Agent,Total Balance');
    });

    it('generates CSV with N/A when oldestCollectionDate is null', async () => {
      const buckets = [{
        agentId: 1,
        totalBalance: new Prisma.Decimal(500),
        bucket_0_1: new Prisma.Decimal(500),
        bucket_2_3: new Prisma.Decimal(0),
        bucket_4_7: new Prisma.Decimal(0),
        bucket_8_plus: new Prisma.Decimal(0),
        oldestCollectionDate: null, // triggers 'N/A' branch
        agent: { id: 1, firstName: 'Jane', lastName: 'Smith', email: 'j@test.com' },
      }];
      mockPrisma.agentAgingBucket.findMany.mockResolvedValue(buckets);
      mockPrisma.agentBalance.findMany.mockResolvedValue([]);
      mockPrisma.agentBalance.count.mockResolvedValue(0);

      const csv = await agingService.generateAgingCSV();
      expect(csv).toContain('N/A');
    });
  });
});
