import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { parseExpression } from 'cron-parser';

// M8-T06 (COD-71): the repeat rule, the tenant loop, one failure not stopping the next.

const mockAdd = jest.fn<(...a: any[]) => any>();
let processCallback: (...args: any[]) => Promise<void>;
jest.mock('bull', () => jest.fn().mockImplementation(() => ({
  process: jest.fn((_name: string, cb: any) => { processCallback = cb; }),
  on: jest.fn(),
  add: (...a: any[]) => mockAdd(...a),
  close: jest.fn(),
  getRepeatableJobs: jest.fn().mockResolvedValue([] as any),
  removeRepeatableByKey: jest.fn(),
})));

// The queue builds a real Bull queue only outside the test environment
const originalEnv = process.env.NODE_ENV;
process.env.NODE_ENV = 'production';

import '../mocks/logger.mock';
import { prismaMock } from '../mocks/prisma.mock';
import { getTenantId } from '../../utils/tenantContext';

const mockCheckTokens = jest.fn<() => Promise<void>>();
jest.mock('../../services/metaTokenHealthService', () => ({ checkAdsTokens: () => mockCheckTokens() }));
const mockRun = jest.fn<(id: number) => Promise<string[]>>();
jest.mock('../../services/marketing/metaPullRunner', () => ({ runAccountPull: (id: number) => mockRun(id) }));

import { setupMetaPullCron, META_PULL_REPEAT, metaPullQueue } from '../../queues/metaPullQueue';

process.env.NODE_ENV = originalEnv;

describe('metaPullQueue schedule', () => {
  afterEach(() => jest.useRealTimers());

  it('registers a daily repeat at 05:00 Africa/Accra', async () => {
    (metaPullQueue.getRepeatableJobs as any).mockResolvedValue([]);
    process.env.NODE_ENV = 'production';
    await setupMetaPullCron();
    process.env.NODE_ENV = originalEnv;
    expect(mockAdd).toHaveBeenCalledWith('pull-meta-insights', {}, { repeat: { cron: '0 5 * * *', tz: 'Africa/Accra' } });
  });

  it('fires at 05:00 Accra time: fake clock just before and just after', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-11T04:59:30Z'));
    const next = (from: Date) => parseExpression(META_PULL_REPEAT.cron, { currentDate: from, tz: META_PULL_REPEAT.tz }).next().toDate();
    expect(next(new Date())).toEqual(new Date('2026-11-11T05:00:00Z'));
    jest.setSystemTime(new Date('2026-11-11T05:00:30Z'));
    expect(next(new Date())).toEqual(new Date('2026-11-12T05:00:00Z'));
  });
});

describe('processMetaPull', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckTokens.mockResolvedValue(undefined);
    mockRun.mockResolvedValue(['2026-11-11']);
  });

  it('checks tokens, then pulls each enabled connected account, inside each tenant', async () => {
    (prismaMock.tenant.findMany as any).mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    const order: string[] = [];
    mockCheckTokens.mockImplementation(async () => { order.push(`check:${getTenantId()}`); });
    (prismaMock.metaAdAccount.findMany as any).mockImplementation(async (args: any) => {
      expect(args.where).toEqual({ enabled: true, status: 'connected' });
      return getTenantId() === 't1' ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }];
    });
    mockRun.mockImplementation(async (id) => { order.push(`pull:${id}:${getTenantId()}`); return []; });
    await processCallback();
    expect(order).toEqual(['check:t1', 'pull:1:t1', 'pull:2:t1', 'check:t2', 'pull:3:t2']);
  });

  it('one failing account does not stop the next account', async () => {
    (prismaMock.tenant.findMany as any).mockResolvedValue([{ id: 't1' }]);
    (prismaMock.metaAdAccount.findMany as any).mockResolvedValue([{ id: 1 }, { id: 2 }]);
    mockRun.mockRejectedValueOnce(new Error('boom'));
    await processCallback();
    expect(mockRun.mock.calls.map((c) => c[0])).toEqual([1, 2]);
  });

  it('a failing tenant does not stop the next tenant (the job still ends failed)', async () => {
    (prismaMock.tenant.findMany as any).mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    (prismaMock.metaAdAccount.findMany as any).mockImplementation(async () => {
      if (getTenantId() === 't1') throw new Error('db down for t1');
      return [{ id: 9 }];
    });
    await expect(processCallback()).rejects.toThrow(/failed for 1\/2 tenants/);
    expect(mockRun).toHaveBeenCalledWith(9);
  });
});
