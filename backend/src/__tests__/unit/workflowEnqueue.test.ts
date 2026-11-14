import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaMock } from '../mocks/prisma.mock';

const mockAdd = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock('../../queues/workflowQueue', () => ({
  workflowQueue: { add: (...a: any[]) => (mockAdd as any)(...a) },
}));

import {
  enqueueWorkflowRun, runJobId, ENQUEUE_TIMEOUT_MS, RETRY_DELAY_MS, MAX_RETRIES, QUEUE_DOWN_ERROR,
} from '../../queues/workflowEnqueue';

const job = { executionId: 42, workflowId: 7, actions: [], conditions: null, input: { orderId: 1 }, tenantId: 'tenant-a' };

describe('enqueueWorkflowRun (M9-T21: a queue that is down never fails the caller)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('adds the job with a deterministic id', async () => {
    mockAdd.mockResolvedValue({});
    await expect(enqueueWorkflowRun(job)).resolves.toBe(true);
    expect(mockAdd).toHaveBeenCalledWith('execute-workflow', job, { jobId: runJobId(42) });
    expect(runJobId(42)).toBe('wf-run:42');
  });

  it('a failed add resolves false at once (no throw) and is tried again 30 s later', async () => {
    mockAdd.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValue({});
    await expect(enqueueWorkflowRun(job)).resolves.toBe(false);
    expect(mockAdd).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS - 1);
    expect(mockAdd).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(mockAdd).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS * 5); // queued: no more tries
    expect(mockAdd).toHaveBeenCalledTimes(2);
    expect(prismaMock.workflowExecution.update).not.toHaveBeenCalled();
  });

  it('an add that never answers gives up after 5 s and retries', async () => {
    mockAdd.mockReturnValueOnce(new Promise(() => { /* Redis down: hangs */ })).mockResolvedValue({});
    const outcome = enqueueWorkflowRun(job);
    await jest.advanceTimersByTimeAsync(ENQUEUE_TIMEOUT_MS);
    await expect(outcome).resolves.toBe(false);
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    expect(mockAdd).toHaveBeenCalledTimes(2);
  });

  it('after 3 failed retries (4 adds) the execution is marked failed and nothing more runs', async () => {
    mockAdd.mockRejectedValue(new Error('down'));
    (prismaMock.workflowExecution.update as any).mockResolvedValue({});
    await enqueueWorkflowRun(job);
    expect(MAX_RETRIES).toBe(3);
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS * MAX_RETRIES);
    expect(mockAdd).toHaveBeenCalledTimes(1 + MAX_RETRIES);
    expect(prismaMock.workflowExecution.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 42 }, data: expect.objectContaining({ status: 'failed', error: QUEUE_DOWN_ERROR }),
    }));
    await jest.advanceTimersByTimeAsync(RETRY_DELAY_MS * 5);
    expect(mockAdd).toHaveBeenCalledTimes(1 + MAX_RETRIES);
  });
});
