import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';

const mockNotify = jest.fn<(...a: any[]) => Promise<any>>();
jest.mock('../../services/inbox/inboxService', () => ({ notify: (...a: any[]) => mockNotify(...a) }));
const mockVisible = jest.fn<(...a: any[]) => Promise<void>>();
jest.mock('../../services/inbox/subjectAccess', () => ({
  NOTE_SUBJECT_TYPES: ['order', 'customer', 'payout', 'product'],
  assertSubjectVisible: (...a: any[]) => mockVisible(...a),
}));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { assertDueAtValid, createReminder, processDueReminders, updateReminder } from '../../services/reminderService';
import { reminderCreateSchema } from '../../validators/reminderSchema';
import { runInTenant } from '../../utils/tenantContext';

const NOW = new Date('2026-11-14T10:00:00Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
const HOUR = 3600_000;
const DAY = 24 * HOUR;
const reminder = (over: Record<string, unknown> = {}) => ({
  id: 1, tenantId: 't1', createdById: 10, assignedToId: 11, subjectType: 'order', subjectId: 5, note: 'Call back', dueAt: at(-60_000),
  status: 'pending', sentAt: null, ...over,
});
const user = (id: number, firstName: string, isActive: boolean) => ({ id, firstName, lastName: 'T', isActive });

beforeEach(() => {
  mockNotify.mockResolvedValue([]);
  mockVisible.mockResolvedValue(undefined);
});

describe('reminder validation', () => {
  it('refuses a past time, a time more than a year ahead, and accepts the range between', () => {
    expect(() => assertDueAtValid(at(-1), NOW)).toThrow('future');
    expect(() => assertDueAtValid(NOW, NOW)).toThrow('future');
    expect(() => assertDueAtValid(at(367 * DAY), NOW)).toThrow('one year');
    expect(() => assertDueAtValid(at(HOUR), NOW)).not.toThrow();
    expect(() => assertDueAtValid(at(365 * DAY), NOW)).not.toThrow();
  });

  it('the body: note max 1000, both subject fields or none, known subject type', () => {
    const ok = { note: 'x', dueAt: '2027-01-01T00:00:00Z' };
    expect(reminderCreateSchema.safeParse(ok).success).toBe(true);
    expect(reminderCreateSchema.safeParse({ ...ok, note: 'x'.repeat(1001) }).success).toBe(false);
    expect(reminderCreateSchema.safeParse({ ...ok, note: 'x'.repeat(1000) }).success).toBe(true);
    expect(reminderCreateSchema.safeParse({ ...ok, subjectType: 'order' }).success).toBe(false);
    expect(reminderCreateSchema.safeParse({ ...ok, subjectType: 'order', subjectId: 3 }).success).toBe(true);
    expect(reminderCreateSchema.safeParse({ ...ok, subjectType: 'workflow', subjectId: 3 }).success).toBe(false);
    expect(reminderCreateSchema.safeParse({ ...ok, dueAt: 'tomorrow' }).success).toBe(false);
  });

  it('create: a past time is refused before any lookup; a missing or inactive assignee is 400; the subject is checked', async () => {
    await expect(createReminder({ note: 'n', dueAt: at(-1000) }, { id: 10, role: 'sales_rep' }, NOW)).rejects.toMatchObject({ statusCode: 400 });
    expect(mockVisible).not.toHaveBeenCalled();

    (prismaMock.user.findFirst as any).mockResolvedValue(null);
    await expect(runInTenant('t1', () => createReminder({ note: 'n', dueAt: at(HOUR), assignedToId: 99 }, { id: 10, role: 'sales_rep' }, NOW)))
      .rejects.toMatchObject({ statusCode: 400 });

    (prismaMock.user.findFirst as any).mockResolvedValue({ id: 10 });
    (prismaMock.reminder.create as any).mockImplementation(async ({ data }: any) => ({ id: 1, ...data }));
    const made = await runInTenant('t1', () => createReminder({ subjectType: 'order', subjectId: 5, note: 'n', dueAt: at(HOUR) }, { id: 10, role: 'sales_rep' }, NOW));
    expect(mockVisible).toHaveBeenCalledWith('order', 5, { id: 10, role: 'sales_rep' });
    expect(made).toMatchObject({ assignedToId: 10, createdById: 10, tenantId: 't1' }); // default assignee = me
  });

  it('a subject the person may not see stops the create', async () => {
    mockVisible.mockRejectedValue(Object.assign(new Error('no'), { statusCode: 403 }));
    await expect(createReminder({ subjectType: 'order', subjectId: 5, note: 'n', dueAt: at(HOUR) }, { id: 10, role: 'sales_rep' }, NOW)).rejects.toMatchObject({ statusCode: 403 });
    expect(prismaMock.reminder.create).not.toHaveBeenCalled();
  });
});

describe('who may change a reminder', () => {
  const run = (u: { id: number; role: string }, patch: any) => runInTenant('t1', () => updateReminder(1, patch, u, NOW));
  beforeEach(() => {
    (prismaMock.reminder.findFirst as any).mockResolvedValue(reminder({ dueAt: at(HOUR) }));
    (prismaMock.reminder.updateMany as any).mockResolvedValue({ count: 1 });
  });
  it('the creator, the assignee, an admin and the owner may; another rep may not', async () => {
    for (const u of [{ id: 10, role: 'sales_rep' }, { id: 11, role: 'sales_rep' }, { id: 50, role: 'admin' }, { id: 51, role: 'super_admin' }]) {
      await expect(run(u, { note: 'new' })).resolves.toBeTruthy();
    }
    await expect(run({ id: 12, role: 'sales_rep' }, { note: 'new' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(run({ id: 52, role: 'manager' }, { cancel: true })).rejects.toMatchObject({ statusCode: 403 });
  });
  it('a sent reminder cannot change; a new past due time is refused', async () => {
    (prismaMock.reminder.findFirst as any).mockResolvedValue(reminder({ status: 'sent' }));
    await expect(run({ id: 10, role: 'sales_rep' }, { cancel: true })).rejects.toMatchObject({ statusCode: 409 });
    (prismaMock.reminder.findFirst as any).mockResolvedValue(reminder({ dueAt: at(HOUR) }));
    await expect(run({ id: 10, role: 'sales_rep' }, { dueAt: at(-5) })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('the update names status pending, so a reminder claimed a moment ago is not changed', async () => {
    (prismaMock.reminder.updateMany as any).mockResolvedValue({ count: 0 });
    await expect(run({ id: 10, role: 'sales_rep' }, { cancel: true })).rejects.toMatchObject({ statusCode: 409 });
    expect((prismaMock.reminder.updateMany as any).mock.calls[0][0].where).toEqual({ id: 1, status: 'pending' });
  });
});

describe('due job', () => {
  beforeEach(() => {
    (prismaMock.reminder.findMany as any).mockResolvedValue([{ id: 1, tenantId: 't1' }]);
    (prismaMock.reminder.findFirst as any).mockResolvedValue(reminder());
    (prismaMock.reminder.updateMany as any).mockResolvedValue({ count: 1 });
    (prismaMock.user.findMany as any).mockResolvedValue([user(10, 'Creator', true), user(11, 'Assignee', true)]);
  });

  it('reads pending rows due now, claims with one updateMany, and notifies the assignee', async () => {
    expect(await processDueReminders(NOW)).toBe(1);
    expect((prismaMock.reminder.findMany as any).mock.calls[0][0].where).toEqual({ status: 'pending', dueAt: { lte: NOW } });
    expect((prismaMock.reminder.updateMany as any).mock.calls[0][0]).toMatchObject({
      where: { id: 1, status: 'pending' }, data: { status: 'sent', sentAt: NOW },
    });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][0]).toMatchObject({
      tenantId: 't1', event: 'reminder_due', kind: 'reminder', subject: { type: 'order', id: 5 }, recipients: [11], message: 'Call back',
    });
  });

  it('claim once: a worker that loses the claim sends nothing', async () => {
    (prismaMock.reminder.updateMany as any).mockResolvedValue({ count: 0 });
    expect(await processDueReminders(NOW)).toBe(0);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('two ticks racing on one row: only the one that wins the claim notifies', async () => {
    (prismaMock.reminder.updateMany as any).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const [a, b] = await Promise.all([processDueReminders(NOW), processDueReminders(NOW)]);
    expect(a + b).toBe(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
  });

  it('a deactivated assignee: the creator gets it, with the note about it', async () => {
    (prismaMock.user.findMany as any).mockResolvedValue([user(10, 'Creator', true), user(11, 'Kofi', false)]);
    await processDueReminders(NOW);
    const arg = mockNotify.mock.calls[0][0];
    expect(arg.recipients).toEqual([10]);
    expect(arg.message).toContain('Kofi T is deactivated; this reminder came to you');
    expect(arg.message).toContain('Call back');
  });

  it('assignee and creator both deactivated: the owner', async () => {
    (prismaMock.user.findMany as any).mockResolvedValue([user(10, 'Ama', false), user(11, 'Kofi', false)]);
    await processDueReminders(NOW);
    expect(mockNotify.mock.calls[0][0].recipients).toBe('owner');
  });

  it('a reminder without a subject sends no subject', async () => {
    (prismaMock.reminder.findFirst as any).mockResolvedValue(reminder({ subjectType: null, subjectId: null }));
    await processDueReminders(NOW);
    expect(mockNotify.mock.calls[0][0].subject).toBeUndefined();
  });

  it('if the notification cannot be written the claim is given back and the next tick retries; other rows still go', async () => {
    (prismaMock.reminder.findMany as any).mockResolvedValue([{ id: 1, tenantId: 't1' }, { id: 2, tenantId: 't1' }]);
    (prismaMock.reminder.findFirst as any).mockImplementation(async ({ where }: any) => reminder({ id: where.id }));
    mockNotify.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce([]);
    expect(await processDueReminders(NOW)).toBe(1);
    const calls = (prismaMock.reminder.updateMany as any).mock.calls.map((c: any[]) => c[0]);
    expect(calls).toContainEqual({ where: { id: 1, status: 'sent' }, data: { status: 'pending', sentAt: null } });
  });
});
