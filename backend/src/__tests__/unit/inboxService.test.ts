import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { prismaMock } from '../mocks/prisma.mock';
import { CHANNELS, EVENT_GROUPS, INBOX_EVENTS, INBOX_EVENT_NAMES, eventDefaultFor, getEventDef } from '../../services/inbox/inboxEvents';

const mockSendEmail = jest.fn<(...a: any[]) => Promise<any>>();
jest.mock('../../services/emailService', () => ({ sendEmail: (...a: any[]) => mockSendEmail(...a), getDbEmailConfig: jest.fn() }));
jest.mock('../../sockets', () => ({ emitNotification: jest.fn() }));
jest.mock('../../utils/socketInstance', () => ({ getSocketInstance: () => null }));
const mockChannels = jest.fn<() => Promise<any>>();
jest.mock('../../services/inbox/inboxChannels', () => ({ getTenantChannels: () => mockChannels() }));
jest.mock('../../utils/logger', () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { notify } from '../../services/inbox/inboxService';
import { getMyPreferences, savePreferences, saveRoleDefaults } from '../../services/inbox/inboxPreferences';
import { runInTenant } from '../../utils/tenantContext';
import logger from '../../utils/logger';

const T = 'tenant-a';
const person = (id: number, role = 'sales_rep') => ({ id, role, email: `u${id}@x.test`, phoneNumber: `+23355000000${id}` });
const allOn = { inApp: { available: true }, email: { available: true } };

const base = (over: Record<string, unknown> = {}) => ({
  tenantId: T, event: 'order_assigned', recipients: [1], title: 'Hello', message: 'World', ...over,
}) as any;

beforeEach(() => {
  jest.clearAllMocks();
  mockChannels.mockResolvedValue(allOn);
  (prismaMock.notificationPreference.findMany as any).mockResolvedValue([]);
  (prismaMock.roleNotificationDefault.findMany as any).mockResolvedValue([]);
  (prismaMock.notification.create as any).mockImplementation(async ({ data }: any) => ({ id: 1, ...data }));
  (prismaMock.user.findMany as any).mockResolvedValue([person(1)]);
});

describe('event list', () => {
  it('has every event the spec names, each with a kind and channel defaults', () => {
    for (const name of ['customer_reply', 'mention', 'reminder_due', 'team_note', 'order_assigned', 'late_callback', 'overdue_collections', 'queue_wait',
      'no_assignee_available', 'agent_blocked', 'stock_incoming', 'payout_paid', 'delivery_rescheduled', 'system_problem',
      'finding_assigned', 'target_returned', 'conversation_assigned']) {
      expect(INBOX_EVENT_NAMES).toContain(name);
      expect(INBOX_EVENTS[name].defaults.inApp).toBe(true);
    }
  });
  it('no longer lists the events that are never sent, or the separate unblock event', () => {
    for (const name of ['workflow_failed', 'connection_error', 'agent_unblocked']) expect(INBOX_EVENT_NAMES).not.toContain(name);
    expect(getEventDef('agent_blocked').label).toBe('Your account was blocked or unblocked');
  });
  it('offers staff only the In-app and Email channels', () => {
    expect([...CHANNELS]).toEqual(['inApp', 'email']);
  });
  it('gives every event a group and at least one role, and lists the groups in order', () => {
    const seen: string[] = [];
    for (const e of Object.values(INBOX_EVENTS)) {
      expect(EVENT_GROUPS).toContain(e.group);
      expect(e.roles.length).toBeGreaterThan(0);
      if (seen[seen.length - 1] !== e.group) seen.push(e.group);
    }
    expect(seen).toEqual([...EVENT_GROUPS]);
  });
  it('maps events to the inbox kinds', () => {
    expect(getEventDef('customer_reply').kind).toBe('reply');
    expect(getEventDef('mention').kind).toBe('mention');
    expect(getEventDef('reminder_due').kind).toBe('reminder');
    expect(getEventDef('team_note').kind).toBe('note');
    expect(getEventDef('system_problem').kind).toBe('system');
    expect(getEventDef('late_callback').kind).toBe('alert');
  });
  it('only system_problem is owner in-app required, and it adds email for owners by role default', () => {
    expect(INBOX_EVENT_NAMES.filter((n) => INBOX_EVENTS[n].ownerInAppRequired)).toEqual(['system_problem']);
    expect(eventDefaultFor(getEventDef('system_problem'), 'admin').email).toBe(true);
    expect(eventDefaultFor(getEventDef('system_problem'), 'sales_rep').email).toBe(false);
  });
  it('refuses an unknown event', async () => {
    await expect(notify(base({ event: 'nope' }))).rejects.toThrow('Unknown inbox event');
  });
});

describe('notify recipients', () => {
  it('writes the in-app row with kind, subject and actor', async () => {
    const rows = await notify(base({ subject: { type: 'order', id: 9 }, actorId: 5 }));
    expect(rows).toHaveLength(1);
    expect((prismaMock.notification.create as any).mock.calls[0][0].data).toMatchObject({
      tenantId: T, userId: 1, type: 'order_assigned', kind: 'alert', subjectType: 'order', subjectId: 9, actorId: 5, title: 'Hello',
    });
  });

  it('an empty list goes to the owner', async () => {
    (prismaMock.user.findMany as any)
      .mockResolvedValueOnce([{ id: 7 }]) // findTenantAdmins
      .mockResolvedValueOnce([person(7, 'super_admin')]);
    const rows = await notify(base({ recipients: [] }));
    expect(rows.map((r) => r.userId)).toEqual([7]);
  });

  it("'owner' goes to the tenant admins", async () => {
    (prismaMock.user.findMany as any)
      .mockResolvedValueOnce([{ id: 7 }, { id: 8 }])
      .mockResolvedValueOnce([person(7, 'super_admin'), person(8, 'admin')]);
    const rows = await notify(base({ recipients: 'owner' }));
    expect(rows.map((r) => r.userId)).toEqual([7, 8]);
  });

  it('recipients who are all deactivated go to the owner', async () => {
    (prismaMock.user.findMany as any)
      .mockResolvedValueOnce([]) // none active among the named
      .mockResolvedValueOnce([{ id: 7 }])
      .mockResolvedValueOnce([person(7, 'admin')]);
    const rows = await notify(base({ recipients: [1, 2] }));
    expect(rows.map((r) => r.userId)).toEqual([7]);
    expect((prismaMock.user.findMany as any).mock.calls[0][0].where).toMatchObject({ isActive: true });
  });

  it('the actor is never notified about their own action, and the owner is not a fallback for that', async () => {
    const rows = await notify(base({ recipients: [5], actorId: 5 }));
    expect(rows).toEqual([]);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
    expect(prismaMock.user.findMany).not.toHaveBeenCalled();
  });

  it('drops the actor from a longer list', async () => {
    await notify(base({ recipients: [5, 1], actorId: 5 }));
    expect((prismaMock.user.findMany as any).mock.calls[0][0].where.id).toEqual({ in: [1] });
  });

  it('an owner fallback never lands on the actor', async () => {
    (prismaMock.user.findMany as any).mockResolvedValueOnce([{ id: 7 }, { id: 8 }]);
    (prismaMock.user.findMany as any).mockResolvedValueOnce([person(8, 'admin')]);
    await notify(base({ recipients: 'owner', actorId: 7 }));
    expect((prismaMock.user.findMany as any).mock.calls[1][0].where.id).toEqual({ in: [8] });
  });
});

describe('external channels', () => {
  const prefs = (row: Record<string, unknown>) => (prismaMock.notificationPreference.findMany as any).mockResolvedValue([{ userId: 1, event: 'order_assigned', ...row }]);

  it('sends email when the person chose it', async () => {
    prefs({ inApp: true, email: true });
    await notify(base());
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'u1@x.test', subject: 'Hello' }));
  });

  it('sends nothing external by default', async () => {
    await notify(base());
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('keeps the in-app row when the email send fails, and logs the failure', async () => {
    prefs({ inApp: true, email: true });
    mockSendEmail.mockRejectedValue(new Error('smtp down'));
    const rows = await notify(base());
    expect(rows).toHaveLength(1);
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    expect((logger.warn as any).mock.calls.filter((c: any[]) => c[0] === 'Inbox: external notification failed')).toHaveLength(1);
  });

  it('writes the in-app row before any external send', async () => {
    prefs({ inApp: true, email: true });
    const order: string[] = [];
    (prismaMock.notification.create as any).mockImplementation(async ({ data }: any) => { order.push('row'); return { id: 1, ...data }; });
    mockSendEmail.mockImplementation(async () => { order.push('email'); });
    await notify(base());
    expect(order).toEqual(['row', 'email']);
  });

  it('skips email when the tenant has not connected it', async () => {
    prefs({ inApp: true, email: true });
    mockChannels.mockResolvedValue({ ...allOn, email: { available: false, hint: 'x' } });
    await notify(base());
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('ignores stored SMS and WhatsApp choices: nothing is sent on those channels', async () => {
    prefs({ inApp: true, email: false, sms: true, whatsapp: true });
    const rows = await notify(base());
    expect(rows).toHaveLength(1);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe('preference merge order', () => {
  it('person beats role default beats event default', async () => {
    const notifyWith = async (prefRows: any[], roleRows: any[]) => {
      jest.clearAllMocks();
      (prismaMock.notificationPreference.findMany as any).mockResolvedValue(prefRows);
      (prismaMock.roleNotificationDefault.findMany as any).mockResolvedValue(roleRows);
      mockChannels.mockResolvedValue(allOn);
      await notify(base());
      return mockSendEmail.mock.calls.length;
    };
    const role = [{ role: 'sales_rep', event: 'order_assigned', inApp: true, email: true }];
    const mine = [{ userId: 1, event: 'order_assigned', inApp: true, email: false }];
    expect(await notifyWith([], [])).toBe(0); // event default: in-app only
    expect(await notifyWith([], role)).toBe(1); // role default turns email on
    expect(await notifyWith(mine, role)).toBe(0); // the person turns it off again
  });

  it('a person can turn in-app off for a normal event: no row', async () => {
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([{ userId: 1, event: 'order_assigned', inApp: false, email: false }]);
    expect(await notify(base())).toEqual([]);
  });

  it('getMyPreferences merges the three layers and marks unconnected channels', async () => {
    mockChannels.mockResolvedValue({ ...allOn, email: { available: false, hint: 'Connect email in Connections to turn this on.' } });
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([{ userId: 1, event: 'mention', inApp: true, email: true }]);
    (prismaMock.roleNotificationDefault.findMany as any).mockResolvedValue([{ role: 'sales_rep', event: 'team_note', inApp: true, email: true }]);
    const rows = await runInTenant(T, () => getMyPreferences({ id: 1, role: 'sales_rep' as any }));
    const by = Object.fromEntries(rows.map((r) => [r.event, r]));
    expect(by.mention).toMatchObject({ source: 'person' });
    expect(by.mention.channels.email.enabled).toBe(true);
    expect(by.team_note).toMatchObject({ source: 'role' });
    expect(by.team_note.channels.email.enabled).toBe(true);
    expect(by.customer_reply).toMatchObject({ source: 'default' });
    expect(by.customer_reply.channels.email.enabled).toBe(false);
    expect(by.customer_reply.channels.email).toMatchObject({ available: false, hint: 'Connect email in Connections to turn this on.' });
    expect(by.customer_reply.channels).not.toHaveProperty('sms');
    expect(by.customer_reply.channels.inApp.available).toBe(true);
  });
});

describe('owner and system_problem', () => {
  it('still writes the in-app row for an owner who has it off in the database', async () => {
    (prismaMock.user.findMany as any).mockResolvedValue([person(1, 'super_admin')]);
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([{ userId: 1, event: 'system_problem', inApp: false, email: false }]);
    const rows = await notify(base({ event: 'system_problem' }));
    expect(rows).toHaveLength(1);
  });

  it('refuses the owner turning in-app off for system_problem (person and role default)', async () => {
    await expect(runInTenant(T, () => savePreferences({ id: 1, role: 'super_admin' as any }, [{ event: 'system_problem', inApp: false }])))
      .rejects.toMatchObject({ statusCode: 400, errorCode: 'OWNER_IN_APP_REQUIRED' });
    await expect(runInTenant(T, () => saveRoleDefaults('admin' as any, [{ event: 'system_problem', inApp: false }])))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prismaMock.notificationPreference.upsert).not.toHaveBeenCalled();
  });

  it('lets the owner turn off email', async () => {
    (prismaMock.notificationPreference.upsert as any).mockResolvedValue({});
    await runInTenant(T, () => savePreferences({ id: 1, role: 'super_admin' as any }, [{ event: 'system_problem', email: false }]));
    expect(prismaMock.notificationPreference.upsert).toHaveBeenCalledTimes(1);
  });

  it('refuses an unknown event', async () => {
    await expect(runInTenant(T, () => savePreferences({ id: 1, role: 'manager' as any }, [{ event: 'nope', inApp: true }])))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('role filter', () => {
  const eventsOf = async (role: string) => (await runInTenant(T, () => getMyPreferences({ id: 1, role: role as any }))).map((r) => r.event);

  it('lists only the events that reach the role', async () => {
    const rep = await eventsOf('sales_rep');
    expect(rep).toEqual(expect.arrayContaining(['customer_reply', 'order_assigned', 'late_callback', 'mention']));
    expect(rep).not.toEqual(expect.arrayContaining(['queue_wait']));
    expect(rep).not.toContain('system_problem');
    expect(rep).not.toContain('stock_incoming');
    const agent = await eventsOf('delivery_agent');
    expect(agent).toEqual(expect.arrayContaining(['stock_incoming', 'payout_paid', 'delivery_rescheduled', 'agent_blocked']));
    expect(agent).not.toContain('customer_reply');
    expect(await eventsOf('super_admin')).toEqual(expect.arrayContaining(['system_problem', 'queue_wait', 'overdue_collections', 'no_assignee_available']));
  });

  it('refuses to save an event that does not reach the role (400), for a person and for a role default', async () => {
    await expect(runInTenant(T, () => savePreferences({ id: 1, role: 'sales_rep' as any }, [{ event: 'system_problem', email: true }])))
      .rejects.toMatchObject({ statusCode: 400, errorCode: 'EVENT_NOT_FOR_ROLE' });
    await expect(runInTenant(T, () => saveRoleDefaults('delivery_agent' as any, [{ event: 'queue_wait', email: true }])))
      .rejects.toMatchObject({ statusCode: 400, errorCode: 'EVENT_NOT_FOR_ROLE' });
    expect(prismaMock.notificationPreference.upsert).not.toHaveBeenCalled();
    expect(prismaMock.roleNotificationDefault.upsert).not.toHaveBeenCalled();
  });
});

describe('refreshUnread', () => {
  it('updates the unread row instead of adding a copy', async () => {
    (prismaMock.notification.findFirst as any).mockResolvedValue({ id: 33 });
    (prismaMock.notification.update as any).mockImplementation(async ({ data }: any) => ({ id: 33, userId: 1, ...data }));
    await notify(base({ event: 'overdue_collections', refreshUnread: true }));
    expect(prismaMock.notification.update).toHaveBeenCalledTimes(1);
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });
});
