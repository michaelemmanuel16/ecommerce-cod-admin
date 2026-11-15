/**
 * M9-T48 (COD-85): two tenants, all 13 new M9 models.
 *
 * Part 1 asks each of the 12 tenant models the same questions through the tenant client (the layer every
 * service and controller reads through): tenant A cannot list B's row, cannot get it by id, cannot change
 * it, cannot delete it, and B's row is untouched at the end. Models with an endpoint are also checked over
 * HTTP in the endpoint suites (see the table in the T48 report).
 * Part 2: ConnectionEvent over HTTP, B's rows never reach A.
 * Part 3: PendingMessageEvent is a system table with no tenant column. The tenant lives in the held
 * envelope; a held event for tenant A must never change a message of tenant B.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { messageStatus } from '../../services/messaging/messageStatus';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

const SUFFIX = Date.now();
const EXEC_ID = Number(String(SUFFIX).slice(-9));

type Side = { tenantId: string; userId: number; token: string };
let A: Side;
let B: Side;
const pendingIds: number[] = [];

async function mkSide(label: string): Promise<Side> {
  const tenantId = (await createTenant(`T48 ${label}`)).id;
  const owner = await mkUser(tenantId, `owner-${label}`, 'super_admin');
  return { tenantId, userId: owner.id, token: owner.token };
}

/** One row per model for one tenant, written with the un-extended client and an explicit tenantId. */
async function seed(side: Side, tag: string) {
  const t = side.tenantId;
  const log = await prismaBase.messageLog.create({
    data: { channel: 'sms', messageBody: `t48 ${tag}`, status: 'sent', providerMessageId: `t48-${tag}-${SUFFIX}`, provider: 'arkesel', tenantId: t } as any,
  });
  const thread = await prismaBase.thread.create({ data: { subjectType: 'order', subjectId: 1, tenantId: t } });
  return {
    MessageEvent: await prismaBase.messageEvent.create({ data: { messageLogId: log.id, status: 'sent', occurredAt: new Date(), tenantId: t } }),
    Conversation: await prismaBase.conversation.create({ data: { channel: 'whatsapp', phone: `+23355${tag === 'a' ? '1' : '2'}${String(SUFFIX).slice(-6)}`, lastMessageAt: new Date(), tenantId: t } }),
    MessageTemplate: await prismaBase.messageTemplate.create({ data: { channel: 'sms', name: `t48-${tag}-${SUFFIX}`, body: 'Hello', tenantId: t } }),
    OptOutEvent: await prismaBase.optOutEvent.create({ data: { phone: `+23355${tag === 'a' ? '3' : '4'}${String(SUFFIX).slice(-6)}`, channel: 'sms', optedOut: true, reason: 'staff', tenantId: t } as any }),
    Reminder: await prismaBase.reminder.create({ data: { createdById: side.userId, assignedToId: side.userId, note: `t48 ${tag}`, dueAt: new Date(Date.now() + 3600_000), tenantId: t } }),
    Thread: thread,
    Comment: await prismaBase.comment.create({ data: { threadId: thread.id, authorId: side.userId, body: `t48 ${tag}`, tenantId: t } }),
    ThreadRead: await prismaBase.threadRead.create({ data: { threadId: thread.id, userId: side.userId, lastReadAt: new Date(), tenantId: t } }),
    NotificationPreference: await prismaBase.notificationPreference.create({ data: { userId: side.userId, event: 't48_event', tenantId: t } }),
    RoleNotificationDefault: await prismaBase.roleNotificationDefault.create({ data: { role: 'manager', event: 't48_event', tenantId: t } }),
    WorkflowTriggerOutbox: await prismaBase.workflowTriggerOutbox.create({ data: { event: 't48', payload: { tag }, tenantId: t } }),
    ConnectionEvent: await prismaBase.connectionEvent.create({ data: { connection: 'sms', level: 'error', message: `t48 problem ${tag}`, tenantId: t } }),
  };
}

type Seeded = Awaited<ReturnType<typeof seed>>;
let rowsA: Seeded;
let rowsB: Seeded;

beforeAll(async () => {
  A = await mkSide('a');
  B = await mkSide('b');
  rowsA = await seed(A, 'a');
  rowsB = await seed(B, 'b');
}, 60_000);

afterAll(async () => {
  await prismaBase.pendingMessageEvent.deleteMany({ where: { id: { in: pendingIds } } });
  // deleteTenantRows does not know the M9 tables; the ones that point at users go first
  const t = { tenantId: { in: [A.tenantId, B.tenantId] } };
  for (const d of ['messageEvent', 'comment', 'threadRead', 'thread', 'reminder', 'notificationPreference', 'roleNotificationDefault', 'workflowTriggerOutbox', 'connectionEvent', 'optOutEvent', 'conversation', 'messageTemplate']) {
    await (prismaBase as any)[d].deleteMany({ where: t });
  }
  await deleteTenantRows([A.tenantId, B.tenantId]);
  await prismaBase.$disconnect();
});

// model name -> delegate name on the client, and a harmless change to try
const MODELS: Array<[keyof Seeded, string, Record<string, unknown>]> = [
  ['MessageEvent', 'messageEvent', { providerStatus: 'hacked' }],
  ['Conversation', 'conversation', { unanswered: true }],
  ['MessageTemplate', 'messageTemplate', { body: 'hacked' }],
  ['OptOutEvent', 'optOutEvent', { note: 'hacked' }],
  ['Reminder', 'reminder', { note: 'hacked' }],
  ['Thread', 'thread', { archivedAt: new Date() }],
  ['Comment', 'comment', { body: 'hacked' }],
  ['ThreadRead', 'threadRead', { lastReadAt: new Date(0) }],
  ['NotificationPreference', 'notificationPreference', { inApp: false }],
  ['RoleNotificationDefault', 'roleNotificationDefault', { inApp: false }],
  ['WorkflowTriggerOutbox', 'workflowTriggerOutbox', { lastError: 'hacked' }],
  ['ConnectionEvent', 'connectionEvent', { message: 'hacked' }],
];

describe('tenant A against tenant B rows, every tenant model', () => {
  it.each(MODELS)('%s: no list, no get by id, no change, no delete', async (name, delegate, change) => {
    const idB = (rowsB[name] as { id: number }).id;
    const idA = (rowsA[name] as { id: number }).id;
    const db = (prisma as any)[delegate];
    const raw = (prismaBase as any)[delegate];

    await runInTenant(A.tenantId, async () => {
      const listed = await db.findMany({ where: { tenantId: { in: [A.tenantId, B.tenantId] } } });
      const ids = listed.map((r: any) => r.id);
      expect(ids).toContain(idA);
      expect(ids).not.toContain(idB);
      expect(listed.every((r: any) => r.tenantId === A.tenantId)).toBe(true);

      expect(await db.findUnique({ where: { id: idB } })).toBeNull();
      expect(await db.findFirst({ where: { id: idB } })).toBeNull();
      expect(await db.count({ where: { id: idB } })).toBe(0);

      await expect(db.update({ where: { id: idB }, data: change })).rejects.toBeTruthy();
      expect((await db.updateMany({ where: { id: idB }, data: change })).count).toBe(0);
      expect((await db.deleteMany({ where: { id: idB } })).count).toBe(0);
      await expect(db.delete({ where: { id: idB } })).rejects.toBeTruthy();
    });

    // B's row is as it was, and A can still read its own
    const after = await raw.findUnique({ where: { id: idB } });
    expect(after).not.toBeNull();
    expect(after.tenantId).toBe(B.tenantId);
    expect(after).toEqual(rowsB[name]);
  });

  it('a create inside A that names B as the tenant is written for A, or refused', async () => {
    await runInTenant(A.tenantId, async () => {
      let id: number | undefined;
      try {
        const row = await prisma.connectionEvent.create({ data: { connection: 'sms', level: 'info', message: 't48 forged', tenantId: B.tenantId } });
        id = row.id;
        expect(row.tenantId).toBe(A.tenantId);
      } catch {
        // refused is fine too
      }
      const forged = await prismaBase.connectionEvent.findMany({ where: { message: 't48 forged', tenantId: B.tenantId } });
      expect(forged).toHaveLength(0);
      if (id) await prismaBase.connectionEvent.delete({ where: { id } });
    });
  });
});

describe('ConnectionEvent over HTTP', () => {
  it('each tenant lists only its own rows on /api/connections/activity', async () => {
    const a = await request(app).get('/api/connections/activity').set(bearer(A.token));
    const b = await request(app).get('/api/connections/activity').set(bearer(B.token));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const msgA = a.body.items.map((i: any) => i.message);
    const msgB = b.body.items.map((i: any) => i.message);
    expect(msgA).toContain('t48 problem a');
    expect(msgA).not.toContain('t48 problem b');
    expect(msgB).toContain('t48 problem b');
    expect(msgB).not.toContain('t48 problem a');
    expect(a.body.counts.all).toBe(1);
    expect(b.body.counts.all).toBe(1);
  });
});

describe('WorkflowTriggerOutbox (no endpoint: the service query)', () => {
  it('a run handed to the outbox in tenant A is written with tenant A, and B reads none of it', async () => {
    const { enqueueWorkflowRun } = await import('../../queues/workflowEnqueue');
    const { workflowQueue } = await import('../../queues/workflowQueue');
    jest.spyOn(workflowQueue, 'add').mockRejectedValue(new Error('redis down'));
    const ok = await runInTenant(A.tenantId, () => enqueueWorkflowRun({ executionId: EXEC_ID, tenantId: A.tenantId } as any));
    expect(ok).toBe(false);
    const rows = await prismaBase.workflowTriggerOutbox.findMany({ where: { payload: { path: ['executionId'], equals: EXEC_ID } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(A.tenantId);
    const seenByB = await runInTenant(B.tenantId, () => prisma.workflowTriggerOutbox.findMany({ where: { payload: { path: ['executionId'], equals: EXEC_ID } } }));
    expect(seenByB).toHaveLength(0);
  });
});

describe('PendingMessageEvent (system table, no tenant column)', () => {
  it('has no tenant column: the tenant is in the held envelope', async () => {
    const held = await prismaBase.pendingMessageEvent.findFirst({ where: { providerMessageId: `t48-held-${SUFFIX}` } });
    expect(held).toBeNull();
    await messageStatus.record('whatsapp_cloud', `t48-held-${SUFFIX}`, 'delivered', new Date(), {}, { tenantId: A.tenantId, authenticated: true });
    const row = await prismaBase.pendingMessageEvent.findFirstOrThrow({ where: { providerMessageId: `t48-held-${SUFFIX}` } });
    pendingIds.push(row.id);
    expect((row.payload as any).tenantId).toBe(A.tenantId);
  });

  it('an event held for tenant A never changes a message of tenant B that later gets the same provider id', async () => {
    const pid = `t48-clash-${SUFFIX}`;
    await messageStatus.record('whatsapp_cloud', pid, 'read', new Date(), {}, { tenantId: A.tenantId, authenticated: true });
    const held = await prismaBase.pendingMessageEvent.findFirstOrThrow({ where: { providerMessageId: pid } });
    pendingIds.push(held.id);

    const bLog = await prismaBase.messageLog.create({
      data: { channel: 'whatsapp', messageBody: 't48 b', status: 'sent', providerMessageId: pid, provider: 'whatsapp_cloud', tenantId: B.tenantId } as any,
    });
    const applied = await messageStatus.applyPending(pid, 'whatsapp_cloud');
    expect(applied).toBe(1);

    const after = await prismaBase.messageLog.findUniqueOrThrow({ where: { id: bLog.id } });
    expect(after.status).toBe('sent');
    expect(after.readAt).toBeNull();
    expect(await prismaBase.messageEvent.count({ where: { messageLogId: bLog.id } })).toBe(0);
    // the held row is spent
    expect(await prismaBase.pendingMessageEvent.count({ where: { providerMessageId: pid } })).toBe(0);
    await prismaBase.messageLog.delete({ where: { id: bLog.id } });
  });

  it('an event held for tenant A is applied to tenant A\'s own message', async () => {
    const pid = `t48-own-${SUFFIX}`;
    await messageStatus.record('whatsapp_cloud', pid, 'delivered', new Date(), {}, { tenantId: A.tenantId, authenticated: true });
    const held = await prismaBase.pendingMessageEvent.findFirstOrThrow({ where: { providerMessageId: pid } });
    pendingIds.push(held.id);
    const aLog = await prismaBase.messageLog.create({
      data: { channel: 'whatsapp', messageBody: 't48 a', status: 'sent', providerMessageId: pid, provider: 'whatsapp_cloud', tenantId: A.tenantId } as any,
    });
    expect(await messageStatus.applyPending(pid, 'whatsapp_cloud')).toBe(1);
    expect((await prismaBase.messageLog.findUniqueOrThrow({ where: { id: aLog.id } })).status).toBe('delivered');
    await prismaBase.messageEvent.deleteMany({ where: { messageLogId: aLog.id } });
    await prismaBase.messageLog.delete({ where: { id: aLog.id } });
  });
});
