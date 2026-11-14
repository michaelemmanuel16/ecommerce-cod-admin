import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaMock } from '../mocks/prisma.mock';

jest.mock('../../utils/socketInstance', () => ({ getSocketInstance: jest.fn(() => null) }));
const mockHttp = jest.fn<(action: any) => Promise<any>>();
jest.mock('../../services/workflowActions', () => ({
  runHttpRequestAction: (a: any) => (mockHttp as any)(a),
  updateOrderByWorkflow: jest.fn(),
}));

import {
  processExecuteWorkflow, processResumeWorkflow, resumeJobId, MAX_RUN_ACTIVE_MS, TIME_LIMIT_REASON,
} from '../../queues/workflowQueue';

/** M9-T21: wait is a delayed job, resume continues from the right step, the 10 minute cap ignores waits. */

const TENANT = 'tenant-a';
const step = (n: number) => ({ type: 'http_request', config: { url: `https://example.com/${n}` } });
const wait = (seconds: number) => ({ type: 'wait', config: { duration: seconds } });
const runJob = (executionId: number, actions: any[]) =>
  ({ id: `run-${executionId}`, data: { executionId, workflowId: 1, actions, conditions: null, input: { orderId: 9 }, tenantId: TENANT } }) as any;
const updates = () => (prismaMock.workflowExecution.update as any).mock.calls.map((c: any[]) => c[0].data);
const urlsCalled = () => mockHttp.mock.calls.map((c) => c[0].config.url);

beforeEach(() => {
  mockHttp.mockResolvedValue({ success: true });
  (prismaMock.workflowExecution.update as any).mockResolvedValue({});
});

describe('wait is a Bull delayed job', () => {
  it('saves its state, schedules the resume with the right delay and id, and stops', async () => {
    const queue = { add: jest.fn<any>().mockResolvedValue({}) };
    const actions = [step(1), wait(90), step(2), step(3)];

    await processExecuteWorkflow(runJob(5, actions), queue);

    expect(urlsCalled()).toEqual(['https://example.com/1']); // nothing after the wait ran
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = queue.add.mock.calls[0];
    expect(name).toBe('resume-workflow');
    expect(opts).toEqual({ delay: 90_000, jobId: 'wf-resume:5:2' });
    expect(opts.jobId).toBe(resumeJobId(5, 2));
    expect(data).toMatchObject({ executionId: 5, workflowId: 1, nextIndex: 2, tenantId: TENANT, input: { orderId: 9 } });
    expect(data.actions).toEqual(actions);

    const waiting = updates().find((d: any) => d.status === 'waiting');
    expect(waiting.output.steps.map((s: any) => s.action)).toEqual(['http_request', 'wait']);
    expect(waiting.output.resumeAt).toEqual(expect.any(String));
    expect(updates().some((d: any) => d.status === 'completed')).toBe(false);
  });

  it('100 waits at once: every worker is free at once, 100 distinct delayed jobs', async () => {
    jest.useFakeTimers();
    try {
      const queue = { add: jest.fn<any>().mockResolvedValue({}) };
      const jobs = Array.from({ length: 100 }, (_, i) => processExecuteWorkflow(runJob(1000 + i, [wait(3600), step(1)]), queue));
      // No timer is advanced: if a worker slept through its wait, this would never settle.
      await expect(Promise.all(jobs)).resolves.toHaveLength(100);
      expect(jest.getTimerCount()).toBe(0);
      expect(queue.add).toHaveBeenCalledTimes(100);
      expect(new Set(queue.add.mock.calls.map((c) => c[2].jobId)).size).toBe(100);
      expect(queue.add.mock.calls.every((c) => c[2].delay === 3_600_000)).toBe(true);
      expect(mockHttp).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a wait with no time set runs on without scheduling', async () => {
    const queue = { add: jest.fn<any>() };
    await processExecuteWorkflow(runJob(6, [wait(0), step(1)]), queue);
    expect(queue.add).not.toHaveBeenCalled();
    expect(urlsCalled()).toEqual(['https://example.com/1']);
    expect(updates().at(-1).status).toBe('completed');
  });

  it('two waits in a row: the second schedules with its own index', async () => {
    const queue = { add: jest.fn<any>().mockResolvedValue({}) };
    (prismaMock.workflowExecution.findUnique as any).mockResolvedValue({
      id: 7, status: 'waiting', output: { steps: [{ action: 'wait' }], resumeAt: 'x', activeMs: 0 },
    });
    (prismaMock.workflowExecution.updateMany as any).mockResolvedValue({ count: 1 });
    const actions = [wait(10), step(1), wait(20), step(2)];
    await processResumeWorkflow({ id: 'r', data: { ...runJob(7, actions).data, nextIndex: 1 } } as any, queue);
    expect(queue.add.mock.calls[0][2]).toEqual({ delay: 20_000, jobId: 'wf-resume:7:3' });
    expect(urlsCalled()).toEqual(['https://example.com/1']);
  });

  it('a failed schedule fails the run with the error', async () => {
    const queue = { add: jest.fn<any>().mockRejectedValue(new Error('redis down')) };
    await expect(processExecuteWorkflow(runJob(8, [wait(5)]), queue)).rejects.toThrow('redis down');
    expect(updates().at(-1)).toMatchObject({ status: 'failed', error: 'redis down' });
  });
});

describe('resume', () => {
  const waitingRow = (steps: any[], activeMs = 0) => ({ id: 5, status: 'waiting', output: { steps, resumeAt: 'x', activeMs } });
  const resumeJob = (actions: any[], nextIndex: number) =>
    ({ id: 'wf-resume:5', data: { ...runJob(5, actions).data, nextIndex } }) as any;

  it('continues from the step after the wait and keeps the earlier steps', async () => {
    const queue = { add: jest.fn<any>() };
    const actions = [step(1), wait(60), step(2), step(3)];
    (prismaMock.workflowExecution.findUnique as any).mockResolvedValue(waitingRow([
      { action: 'http_request', success: true }, { action: 'wait', success: true },
    ]));
    (prismaMock.workflowExecution.updateMany as any).mockResolvedValue({ count: 1 });

    await processResumeWorkflow(resumeJob(actions, 2), queue);

    expect(urlsCalled()).toEqual(['https://example.com/2', 'https://example.com/3']); // not step 1 again
    expect(prismaMock.workflowExecution.updateMany).toHaveBeenCalledWith({ where: { id: 5, status: 'waiting' }, data: { status: 'running' } });
    const done = updates().at(-1);
    expect(done.status).toBe('completed');
    expect(done.output.steps.map((s: any) => s.action)).toEqual(['http_request', 'wait', 'http_request', 'http_request']);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each(['completed', 'failed', 'running', 'cancelled'])('an execution that is %s does not run again', async (status) => {
    (prismaMock.workflowExecution.findUnique as any).mockResolvedValue({ ...waitingRow([]), status });
    await processResumeWorkflow(resumeJob([step(1), wait(1), step(2)], 2), { add: jest.fn<any>() });
    expect(mockHttp).not.toHaveBeenCalled();
    expect(prismaMock.workflowExecution.updateMany).not.toHaveBeenCalled();
  });

  it('a missing execution does nothing', async () => {
    (prismaMock.workflowExecution.findUnique as any).mockResolvedValue(null);
    await processResumeWorkflow(resumeJob([step(1)], 0), { add: jest.fn<any>() });
    expect(mockHttp).not.toHaveBeenCalled();
  });

  it('a second job that loses the claim does nothing', async () => {
    (prismaMock.workflowExecution.findUnique as any).mockResolvedValue(waitingRow([]));
    (prismaMock.workflowExecution.updateMany as any).mockResolvedValue({ count: 0 });
    await processResumeWorkflow(resumeJob([step(1), wait(1), step(2)], 2), { add: jest.fn<any>() });
    expect(mockHttp).not.toHaveBeenCalled();
  });

  it('a job without a tenant refuses to run', async () => {
    await expect(processResumeWorkflow({ id: 'x', data: { executionId: 5, actions: [], nextIndex: 0 } } as any, { add: jest.fn<any>() }))
      .rejects.toThrow('has no tenantId');
    expect(prismaMock.workflowExecution.findUnique).not.toHaveBeenCalled();
  });
});

describe('10 minute cap (waits not counted)', () => {
  const MIN = 60_000;
  beforeEach(() => { jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') }); });
  afterEach(() => { jest.useRealTimers(); });
  /** A step that takes `ms` of run time. */
  const slow = (ms: number) => mockHttp.mockImplementationOnce(async () => { jest.setSystemTime(Date.now() + ms); return { success: true }; });

  it('stops a run that executed for more than 10 minutes and marks it failed time_limit', async () => {
    slow(11 * MIN);
    await processExecuteWorkflow(runJob(1, [step(1), step(2)]), { add: jest.fn<any>() }); // resolves: a stopped run is final, Bull must not retry
    expect(urlsCalled()).toEqual(['https://example.com/1']);
    expect(updates().at(-1)).toMatchObject({ status: 'failed', error: TIME_LIMIT_REASON });
    expect(TIME_LIMIT_REASON).toBe('time_limit');
    expect(MAX_RUN_ACTIVE_MS).toBe(10 * MIN);
  });

  it('stops a run whose last step went over the cap', async () => {
    slow(11 * MIN);
    await processExecuteWorkflow(runJob(1, [step(1)]), { add: jest.fn<any>() });
    expect(updates().at(-1)).toMatchObject({ status: 'failed', error: TIME_LIMIT_REASON });
  });

  it('exactly 10 minutes is allowed', async () => {
    slow(10 * MIN);
    await processExecuteWorkflow(runJob(1, [step(1), step(2)]), { add: jest.fn<any>() });
    expect(updates().at(-1).status).toBe('completed');
  });

  it('time spent waiting does not count: 4 min + a 2 hour wait + 4 min completes', async () => {
    const queue = { add: jest.fn<any>().mockResolvedValue({}) };
    const actions = [step(1), wait(2 * 3600), step(2)];
    slow(4 * MIN);
    await processExecuteWorkflow(runJob(5, actions), queue);
    const waiting = updates().find((d: any) => d.status === 'waiting');
    expect(waiting.output.activeMs).toBe(4 * MIN);

    jest.setSystemTime(Date.now() + 2 * 3600_000); // the delayed job fires two hours later
    (prismaMock.workflowExecution.findUnique as any).mockResolvedValue({ id: 5, status: 'waiting', output: waiting.output });
    (prismaMock.workflowExecution.updateMany as any).mockResolvedValue({ count: 1 });
    slow(4 * MIN);
    await processResumeWorkflow({ id: 'r', data: { ...queue.add.mock.calls[0][1] } } as any, queue);
    expect(updates().at(-1).status).toBe('completed');
  });

  it('the time before the wait still counts: 6 min + wait + 6 min fails time_limit', async () => {
    const queue = { add: jest.fn<any>().mockResolvedValue({}) };
    const actions = [step(1), wait(3600), step(2), step(3)];
    slow(6 * MIN);
    await processExecuteWorkflow(runJob(5, actions), queue);
    const waiting = updates().find((d: any) => d.status === 'waiting');

    jest.setSystemTime(Date.now() + 3600_000);
    (prismaMock.workflowExecution.findUnique as any).mockResolvedValue({ id: 5, status: 'waiting', output: waiting.output });
    (prismaMock.workflowExecution.updateMany as any).mockResolvedValue({ count: 1 });
    slow(6 * MIN);
    await processResumeWorkflow({ id: 'r', data: { ...queue.add.mock.calls[0][1] } } as any, queue);
    expect(updates().at(-1)).toMatchObject({ status: 'failed', error: TIME_LIMIT_REASON });
    expect(urlsCalled()).toEqual(['https://example.com/1', 'https://example.com/2']); // step 3 never ran
  });
});

describe('a failing step', () => {
  it('fails the run with the error and keeps the steps so far', async () => {
    mockHttp.mockRejectedValueOnce(new Error('Request refused: "x" points to a private address'));
    await expect(processExecuteWorkflow(runJob(1, [step(1)]), { add: jest.fn<any>() })).rejects.toThrow('private address');
    expect(updates().at(-1)).toMatchObject({
      status: 'failed', error: 'Request refused: "x" points to a private address',
      output: { steps: [{ action: 'http_request', success: false }] },
    });
  });
});
