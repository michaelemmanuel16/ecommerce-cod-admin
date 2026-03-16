import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock server module
jest.mock('../../server', () => ({
  io: { emit: jest.fn(), to: jest.fn().mockReturnThis() },
}));

// Capture the process callback when the queue registers it
let processCallback: (...args: any[]) => Promise<void>;

jest.mock('bull', () => {
  return jest.fn().mockImplementation(() => ({
    process: jest.fn((name: string, cb: any) => {
      processCallback = cb;
    }),
    on: jest.fn(),
    add: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined as any),
    getRepeatableJobs: jest.fn().mockResolvedValue([] as any),
    removeRepeatableByKey: jest.fn(),
  }));
});

// Must mock before importing the queue — set NODE_ENV to non-test so the real Bull path runs
const originalEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';

import { prismaMock } from '../mocks/prisma.mock';

// Mock FinancialSyncService
const mockSyncOrderFinancialData = jest.fn();
jest.mock('../../services/financialSyncService', () => ({
  FinancialSyncService: {
    syncOrderFinancialData: (...args: any[]) => mockSyncOrderFinancialData(...args),
  },
}));

// Mock logger
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: mockLogger,
}));

// Now import the queue — this triggers process() registration
import '../../queues/financialReconciliationQueue';

// Restore NODE_ENV
process.env.NODE_ENV = originalEnv;

const makeOrder = (id: number) => ({
  id,
  status: 'delivered',
  revenueRecognized: false,
  codAmount: 100,
  orderItems: [],
  customer: { id: 1 },
  deliveryAgent: { id: 2 },
  customerRep: null,
});

describe('financialReconciliationQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('logs no-op when zero unsynced orders found', async () => {
    (prismaMock.order.findMany as any).mockResolvedValue([]);

    await processCallback();

    expect(mockLogger.info).toHaveBeenCalledWith(
      'Financial reconciliation: no unsynced delivered orders found.'
    );
    expect(mockSyncOrderFinancialData).not.toHaveBeenCalled();
  });

  it('does not throw when all orders sync successfully', async () => {
    const orders = [makeOrder(1), makeOrder(2)];
    (prismaMock.order.findMany as any).mockResolvedValue(orders);
    mockSyncOrderFinancialData.mockResolvedValue({
      transaction: { id: 1 },
      journalEntry: { entryNumber: 'JE-001' },
    });

    await expect(processCallback()).resolves.toBeUndefined();
    expect(mockSyncOrderFinancialData).toHaveBeenCalledTimes(2);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('2 synced, 0 failed')
    );
  });

  it('warns but does not throw on partial failure', async () => {
    const orders = [makeOrder(1), makeOrder(2), makeOrder(3)];
    (prismaMock.order.findMany as any).mockResolvedValue(orders);

    mockSyncOrderFinancialData
      .mockResolvedValueOnce({ transaction: { id: 1 }, journalEntry: null })
      .mockRejectedValueOnce(new Error('GL account not found'))
      .mockResolvedValueOnce({ transaction: { id: 3 }, journalEntry: null });

    await expect(processCallback()).resolves.toBeUndefined();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Partial reconciliation: 1/3')
    );
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Reconciliation failed for order 2'),
      'GL account not found'
    );
  });

  it('throws when all orders fail for Bull retry', async () => {
    const orders = [makeOrder(1), makeOrder(2)];
    (prismaMock.order.findMany as any).mockResolvedValue(orders);
    mockSyncOrderFinancialData.mockRejectedValue(new Error('DB down'));

    await expect(processCallback()).rejects.toThrow(
      'All 2 orders failed reconciliation'
    );
  });
});
