import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaMock } from '../mocks/prisma.mock';

jest.mock('../../queues/workflowQueue', () => ({
  workflowQueue: {},
  SCHEDULE_JOB: 'run-scheduled-workflow',
}));
const mockEnqueueRun = jest.fn<(...a: any[]) => Promise<any>>();
const mockCreateExecution = jest.fn<(...a: any[]) => Promise<any>>();
jest.mock('../../services/workflowService', () => ({
  __esModule: true,
  default: {
    enqueueRun: (...a: any[]) => (mockEnqueueRun as any)(...a),
    createExecution: (...a: any[]) => (mockCreateExecution as any)(...a),
  },
}));

import {
  readSchedule, validateSchedule, lastPlannedRun, syncWorkflowSchedule, fireScheduledRun, catchUpMissedSchedules,
  scheduleJobId, scheduleKey, MISSED_SCHEDULE_REASON,
} from '../../queues/workflowSchedule';

/** M9-T22: the cron repeat job follows the workflow; a missed run under 1 hour late runs once, later is skipped; a planned time runs once. */

const sched = (over: Record<string, unknown> = {}) => ({
  id: 7, tenantId: 'tenant-a', isActive: true, triggerType: 'time_based',
  triggerData: { cron: '0 9 * * *', timeZone: 'Africa/Accra' }, ...over,
});

function fakeQueue(existing: any[] = []) {
  return {
    getRepeatableJobs: jest.fn<any>().mockResolvedValue(existing),
    removeRepeatableByKey: jest.fn<any>().mockResolvedValue(undefined),
    add: jest.fn<any>().mockResolvedValue({}),
  } as any;
}

describe('schedule validation', () => {
  it('reads cron and time zone, the zone defaulting to Africa/Accra', () => {
    expect(readSchedule({ cron: ' 0 9 * * * ' })).toEqual({ cron: '0 9 * * *', timeZone: 'Africa/Accra' });
    expect(readSchedule({})).toBeNull();
    expect(readSchedule({ cron: '' })).toBeNull();
  });

  it('refuses a missing cron, a bad cron and an unknown zone with 400', () => {
    expect(() => validateSchedule({})).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => validateSchedule({ cron: 'not a cron' })).toThrow(expect.objectContaining({ statusCode: 400 }));
    expect(() => validateSchedule({ cron: '0 9 * * *', timeZone: 'Mars/Base' })).toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  it('fills the zone from the store default when the trigger has none', () => {
    expect(validateSchedule({ cron: '0 9 * * *' }, 'Africa/Lagos').timeZone).toBe('Africa/Lagos');
    expect(validateSchedule({ cron: '0 9 * * *', timeZone: 'Africa/Accra' }, 'Africa/Lagos').timeZone).toBe('Africa/Accra');
  });

  it('lastPlannedRun is the latest planned time in the schedule zone, counting a run planned for exactly now', () => {
    const schedule = { cron: '0 9 * * *', timeZone: 'Africa/Accra' }; // Accra is UTC+0
    expect(lastPlannedRun(schedule, new Date('2026-11-14T10:30:00Z'))?.toISOString()).toBe('2026-11-14T09:00:00.000Z');
    expect(lastPlannedRun(schedule, new Date('2026-11-14T09:00:00Z'))?.toISOString()).toBe('2026-11-14T09:00:00.000Z');
    expect(lastPlannedRun({ cron: '0 9 * * *', timeZone: 'Africa/Lagos' }, new Date('2026-11-14T10:30:00Z'))?.toISOString()).toBe('2026-11-14T08:00:00.000Z');
  });
});

describe('cron sync follows the workflow', () => {
  it('create: adds one repeat job with the cron, the zone and a per-workflow id', async () => {
    const queue = fakeQueue();
    await syncWorkflowSchedule(sched(), queue);
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [name, data, opts] = queue.add.mock.calls[0];
    expect(name).toBe('run-scheduled-workflow');
    expect(data).toEqual({ workflowId: 7, tenantId: 'tenant-a' });
    expect(opts).toMatchObject({ repeat: { cron: '0 9 * * *', tz: 'Africa/Accra' }, jobId: scheduleJobId(7) });
  });

  it('edit: the old repeat job of this workflow is removed first, then the new one added', async () => {
    const queue = fakeQueue([
      { key: 'k-old', name: 'run-scheduled-workflow', id: scheduleJobId(7) },
      { key: 'k-other', name: 'run-scheduled-workflow', id: scheduleJobId(8) },
    ]);
    await syncWorkflowSchedule(sched({ triggerData: { cron: '30 10 * * *', timeZone: 'Africa/Accra' } }), queue);
    expect(queue.removeRepeatableByKey).toHaveBeenCalledTimes(1);
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('k-old'); // not the other workflow's
    expect(queue.add.mock.calls[0][2].repeat.cron).toBe('30 10 * * *');
  });

  it('switched off or deleted: the repeat job is removed and none is added', async () => {
    for (const w of [sched({ isActive: false }), sched()]) {
      const queue = fakeQueue([{ key: 'k', name: 'run-scheduled-workflow', id: scheduleJobId(7) }]);
      await syncWorkflowSchedule(w.isActive ? { ...w, isActive: false } : w, queue); // delete passes isActive false
      expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('k');
      expect(queue.add).not.toHaveBeenCalled();
    }
  });

  it('a workflow that is not a schedule gets no repeat job (and loses an old one)', async () => {
    const queue = fakeQueue([{ key: 'k', name: 'run-scheduled-workflow', id: scheduleJobId(7) }]);
    await syncWorkflowSchedule(sched({ triggerType: 'order_created', triggerData: {} }), queue);
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('k');
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('the stub queue of the test environment is left alone', async () => {
    await expect(syncWorkflowSchedule(sched(), { add: jest.fn() } as any)).resolves.toBeUndefined();
  });
});

describe('a planned run', () => {
  const planned = new Date('2026-11-14T09:00:00Z');
  beforeEach(() => {
    (prismaMock.workflow.findUnique as any).mockResolvedValue({ id: 7, tenantId: 'tenant-a', isActive: true, triggerType: 'time_based', triggerData: {} });
    (prismaMock.workflow.updateMany as any).mockResolvedValue({ count: 1 });
    mockEnqueueRun.mockResolvedValue({ message: 'Workflow execution started', execution: { id: 1 } });
  });

  it('runs with schedule:<id>:<planned ISO time> as its idempotency key, no order, and sets lastScheduledRunAt', async () => {
    const outcome = await fireScheduledRun(7, planned, 'schedule', new Date('2026-11-14T09:00:02Z'));
    expect(outcome).toBe('started');
    expect(mockEnqueueRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }), { scheduledFor: planned.toISOString() }, undefined,
      { triggerSource: 'schedule', idempotencyKey: 'schedule:7:2026-11-14T09:00:00.000Z', orderId: null },
    );
    expect(scheduleKey(7, planned)).toBe('schedule:7:2026-11-14T09:00:00.000Z');
    expect(prismaMock.workflow.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { lastScheduledRunAt: planned } }));
  });

  it('the same planned time a second time starts nothing (the unique key answers with a duplicate)', async () => {
    mockEnqueueRun.mockResolvedValueOnce({ message: 'Workflow execution started', execution: { id: 1 } }).mockResolvedValueOnce({ message: 'Duplicate run ignored' });
    expect(await fireScheduledRun(7, planned, 'schedule', planned)).toBe('started');
    expect(await fireScheduledRun(7, planned, 'catch_up', planned)).toBe('duplicate');
  });

  it('a workflow that is off or gone is ignored', async () => {
    (prismaMock.workflow.findUnique as any).mockResolvedValue({ id: 7, isActive: false, triggerType: 'time_based' });
    expect(await fireScheduledRun(7, planned, 'schedule')).toBe('ignored');
    (prismaMock.workflow.findUnique as any).mockResolvedValue(null);
    expect(await fireScheduledRun(7, planned, 'schedule')).toBe('ignored');
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('1 hour or more late: skipped, written as a skipped execution with reason missed_schedule', async () => {
    mockCreateExecution.mockResolvedValue({ id: 3 });
    const outcome = await fireScheduledRun(7, planned, 'catch_up', new Date(planned.getTime() + 3600_000));
    expect(outcome).toBe('skipped');
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(mockCreateExecution).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }), expect.anything(),
      { triggerSource: 'catch_up', idempotencyKey: 'schedule:7:2026-11-14T09:00:00.000Z' },
      expect.objectContaining({ status: 'skipped', error: MISSED_SCHEDULE_REASON }),
    );
  });

  it('59 minutes late still runs', async () => {
    expect(await fireScheduledRun(7, planned, 'catch_up', new Date(planned.getTime() + 59 * 60_000))).toBe('started');
    expect(mockEnqueueRun.mock.calls[0][3]).toMatchObject({ triggerSource: 'catch_up' });
  });
});

describe('start-up catch-up', () => {
  const now = new Date('2026-11-14T09:40:00Z');
  const wf = (over: Record<string, unknown> = {}) => ({
    id: 7, tenantId: 'tenant-a', isActive: true, triggerType: 'time_based',
    triggerData: { cron: '0 9 * * *', timeZone: 'Africa/Accra' },
    lastScheduledRunAt: new Date('2026-11-13T09:00:00Z'), updatedAt: new Date('2026-11-01T00:00:00Z'), ...over,
  });
  beforeEach(() => {
    (prismaMock.workflow.findUnique as any).mockResolvedValue({ id: 7, tenantId: 'tenant-a', isActive: true, triggerType: 'time_based', triggerData: {} });
    (prismaMock.workflow.updateMany as any).mockResolvedValue({ count: 1 });
    mockEnqueueRun.mockResolvedValue({ message: 'ok', execution: { id: 1 } });
    mockCreateExecution.mockResolvedValue({ id: 2 });
  });

  it('a run missed 40 minutes ago runs once as catch_up', async () => {
    (prismaMock.workflow.findMany as any).mockResolvedValue([wf()]);
    expect(await catchUpMissedSchedules(now)).toBe(1);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(1);
    expect(mockEnqueueRun.mock.calls[0][3]).toMatchObject({ triggerSource: 'catch_up', idempotencyKey: 'schedule:7:2026-11-14T09:00:00.000Z' });
  });

  it('a run missed 2 hours ago is skipped and logged as a skipped execution, not run', async () => {
    (prismaMock.workflow.findMany as any).mockResolvedValue([wf()]);
    expect(await catchUpMissedSchedules(new Date('2026-11-14T11:00:00Z'))).toBe(1);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
    expect(mockCreateExecution.mock.calls[0][3]).toMatchObject({ status: 'skipped', error: 'missed_schedule' });
  });

  it('nothing is missed when the last run is the latest planned time', async () => {
    (prismaMock.workflow.findMany as any).mockResolvedValue([wf({ lastScheduledRunAt: new Date('2026-11-14T09:00:00Z') })]);
    expect(await catchUpMissedSchedules(now)).toBe(0);
    expect(mockEnqueueRun).not.toHaveBeenCalled();
  });

  it('a workflow that never ran counts from its last save', async () => {
    (prismaMock.workflow.findMany as any).mockResolvedValue([wf({ lastScheduledRunAt: null, updatedAt: new Date('2026-11-14T09:30:00Z') })]);
    expect(await catchUpMissedSchedules(now)).toBe(0); // saved after the 09:00 run was due
    (prismaMock.workflow.findMany as any).mockResolvedValue([wf({ lastScheduledRunAt: null, updatedAt: new Date('2026-11-14T08:00:00Z') })]);
    expect(await catchUpMissedSchedules(now)).toBe(1);
  });

  it('one workflow failing does not stop the next', async () => {
    (prismaMock.workflow.findMany as any).mockResolvedValue([wf({ id: 7 }), wf({ id: 8 })]);
    mockEnqueueRun.mockRejectedValueOnce(new Error('boom')).mockResolvedValue({ message: 'ok', execution: { id: 1 } });
    expect(await catchUpMissedSchedules(now)).toBe(1);
    expect(mockEnqueueRun).toHaveBeenCalledTimes(2);
  });
});
