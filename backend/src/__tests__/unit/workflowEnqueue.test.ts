import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaMock } from '../mocks/prisma.mock';

const mockAdd = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock('../../queues/workflowQueue', () => ({
  workflowQueue: { add: (...a: any[]) => (mockAdd as any)(...a) },
}));

import {
  enqueueWorkflowRun, drainWorkflowOutbox, runJobId, ENQUEUE_TIMEOUT_MS, MAX_ATTEMPTS, OUTBOX_KEEP_MS, QUEUE_DOWN_ERROR,
} from '../../queues/workflowEnqueue';

const job = { executionId: 42, workflowId: 7, actions: [], conditions: null, input: { orderId: 1 }, tenantId: 'tenant-a' };
const outboxRow = (over: Record<string, unknown> = {}) => ({
  id: 1, event: 'execute-workflow', payload: job, attempts: 0, lastError: null, createdAt: new Date(), processedAt: null, tenantId: 'tenant-a', ...over,
});

describe('enqueueWorkflowRun (M9-T21: a queue that is down never fails the caller)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (prismaMock.workflowTriggerOutbox.create as any).mockResolvedValue({});
  });
  afterEach(() => { jest.useRealTimers(); });

  it('adds the job with a deterministic id and writes no outbox row', async () => {
    mockAdd.mockResolvedValue({});
    await expect(enqueueWorkflowRun(job)).resolves.toBe(true);
    expect(mockAdd).toHaveBeenCalledWith('execute-workflow', job, { jobId: runJobId(42) });
    expect(runJobId(42)).toBe('wf-run:42');
    expect(prismaMock.workflowTriggerOutbox.create).not.toHaveBeenCalled();
  });

  it('a failed add resolves false at once and leaves an outbox row for the drain', async () => {
    mockAdd.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(enqueueWorkflowRun(job)).resolves.toBe(false);
    expect(prismaMock.workflowTriggerOutbox.create).toHaveBeenCalledWith({
      data: { tenantId: 'tenant-a', event: 'execute-workflow', payload: job, lastError: 'ECONNREFUSED' },
    });
    expect(prismaMock.workflowExecution.update).not.toHaveBeenCalled(); // the run waits, it is not failed
  });

  it('an add that never answers gives up after 5 s and writes the outbox row', async () => {
    mockAdd.mockReturnValueOnce(new Promise(() => { /* Redis down: hangs */ }));
    const outcome = enqueueWorkflowRun(job);
    await jest.advanceTimersByTimeAsync(ENQUEUE_TIMEOUT_MS);
    await expect(outcome).resolves.toBe(false);
    expect(prismaMock.workflowTriggerOutbox.create).toHaveBeenCalledTimes(1);
  });

  it('when the outbox write fails too, the execution is marked failed', async () => {
    mockAdd.mockRejectedValue(new Error('down'));
    (prismaMock.workflowTriggerOutbox.create as any).mockRejectedValue(new Error('db down'));
    (prismaMock.workflowExecution.update as any).mockResolvedValue({});
    await expect(enqueueWorkflowRun(job)).resolves.toBe(false);
    expect(prismaMock.workflowExecution.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 42 }, data: expect.objectContaining({ status: 'failed', error: QUEUE_DOWN_ERROR }),
    }));
  });
});

describe('drainWorkflowOutbox', () => {
  beforeEach(() => {
    (prismaMock.workflowTriggerOutbox.update as any).mockResolvedValue({});
    (prismaMock.workflowTriggerOutbox.deleteMany as any).mockResolvedValue({ count: 0 });
    (prismaMock.workflowExecution.update as any).mockResolvedValue({});
  });

  it('reads unprocessed rows oldest first', async () => {
    (prismaMock.workflowTriggerOutbox.findMany as any).mockResolvedValue([]);
    await drainWorkflowOutbox();
    expect(prismaMock.workflowTriggerOutbox.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { processedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }));
  });

  it('adds each row, sets processedAt and counts the attempt', async () => {
    mockAdd.mockResolvedValue({});
    (prismaMock.workflowTriggerOutbox.findMany as any).mockResolvedValue([outboxRow({ id: 1 }), outboxRow({ id: 2 })]);
    await expect(drainWorkflowOutbox()).resolves.toBe(2);
    expect(mockAdd).toHaveBeenCalledWith('execute-workflow', job, { jobId: runJobId(42) });
    expect(prismaMock.workflowTriggerOutbox.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { processedAt: expect.any(Date), attempts: { increment: 1 }, lastError: null },
    });
  });

  it('a failed add keeps the row open with attempts and lastError', async () => {
    mockAdd.mockRejectedValue(new Error('ECONNREFUSED'));
    (prismaMock.workflowTriggerOutbox.findMany as any).mockResolvedValue([outboxRow({ attempts: 3 })]);
    await expect(drainWorkflowOutbox()).resolves.toBe(0);
    expect(prismaMock.workflowTriggerOutbox.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { attempts: 4, lastError: 'ECONNREFUSED' } });
    expect(prismaMock.workflowExecution.update).not.toHaveBeenCalled();
  });

  it('the 10th failed attempt closes the row and marks the execution failed', async () => {
    mockAdd.mockRejectedValue(new Error('still down'));
    (prismaMock.workflowTriggerOutbox.findMany as any).mockResolvedValue([outboxRow({ attempts: MAX_ATTEMPTS - 1 })]);
    await drainWorkflowOutbox();
    expect(prismaMock.workflowTriggerOutbox.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { attempts: MAX_ATTEMPTS, lastError: 'still down', processedAt: expect.any(Date) },
    });
    expect(prismaMock.workflowExecution.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 42 }, data: expect.objectContaining({ status: 'failed' }),
    }));
  });

  it('deletes rows processed more than 7 days ago', async () => {
    (prismaMock.workflowTriggerOutbox.findMany as any).mockResolvedValue([]);
    const now = new Date('2026-11-14T10:00:00Z');
    await drainWorkflowOutbox(now);
    expect(prismaMock.workflowTriggerOutbox.deleteMany).toHaveBeenCalledWith({
      where: { processedAt: { lt: new Date(now.getTime() - OUTBOX_KEEP_MS) } },
    });
    expect(OUTBOX_KEEP_MS).toBe(7 * 24 * 3600_000);
  });
});
