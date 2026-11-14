/**
 * M9-T18 (COD-80): reminders API and the due job. Real database; the job runs on a real Bull queue (real Redis),
 * also after a simulated restart. Two tenants.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import '../mocks/logger.mock';
import Bull from 'bull';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { smsService } from '../../services/smsService';
import { whatsappService } from '../../services/whatsappService';
import * as emailService from '../../services/emailService';
import { REMINDER_DUE_JOB, processReminderJob } from '../../queues/reminderQueue';
import { processDueReminders } from '../../services/reminderService';
import { createTwoTenants, mkUser, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
let rep2: { id: number; token: string };
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const HOUR = 3600_000;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();
const rep = () => pair.a.users.salesRep;
const owner = () => pair.a.users.admin;
const post = (token: string, body: unknown) => request(app).post('/api/reminders').set(auth(token)).send(body as object);
const inboxRows = (userId: number) => prismaBase.notification.findMany({ where: { userId, type: 'reminder_due' } });

/** A reminder written straight to the database with a controlled due time. */
const seed = (over: Record<string, unknown> = {}) => prismaBase.reminder.create({
  data: { tenantId: pair.a.id, createdById: rep().id, assignedToId: rep().id, note: 'Call the customer', dueAt: new Date(Date.now() - 60_000), ...over } as any,
});

beforeAll(async () => {
  pair = await createTwoTenants('reminders');
  rep2 = await mkUser(pair.a.id, 'rep2', 'sales_rep');
}, 30000);

afterAll(async () => {
  await prismaBase.reminder.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

beforeEach(async () => {
  await prismaBase.reminder.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
  await prismaBase.notification.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
  await prismaBase.notificationPreference.deleteMany({ where: { tenantId: pair.a.id } });
});

describe('POST /api/reminders', () => {
  it('needs a sign-in; the assignee defaults to me; the subject is saved', async () => {
    expect((await request(app).post('/api/reminders').send({})).status).toBe(401);
    const res = await post(rep().token, { subjectType: 'order', subjectId: pair.a.ids.order, note: 'Chase payment', dueAt: iso(HOUR) });
    expect(res.status).toBe(201);
    expect(res.body.reminder).toMatchObject({ assignedToId: rep().id, createdById: rep().id, subjectType: 'order', subjectId: pair.a.ids.order, status: 'pending' });
  });

  it('refuses a past time, a time over a year ahead, a note over 1000 characters, bad subject fields', async () => {
    const ok = { note: 'n', dueAt: iso(HOUR) };
    expect((await post(rep().token, { ...ok, dueAt: iso(-1000) })).status).toBe(400);
    expect((await post(rep().token, { ...ok, dueAt: iso(367 * 24 * HOUR) })).status).toBe(400);
    expect((await post(rep().token, { ...ok, note: 'x'.repeat(1001) })).status).toBe(400);
    expect((await post(rep().token, { ...ok, subjectType: 'order' })).status).toBe(400);
    expect((await post(rep().token, { ...ok, subjectType: 'workflow', subjectId: 1 })).status).toBe(400);
    expect((await post(rep().token, { note: 'n' })).status).toBe(400);
    expect(await prismaBase.reminder.count({ where: { tenantId: pair.a.id } })).toBe(0);
  });

  it('the subject must exist in my tenant (404), and a rep needs to see it (403)', async () => {
    const base = { note: 'n', dueAt: iso(HOUR) };
    expect((await post(rep().token, { ...base, subjectType: 'order', subjectId: 999999999 })).status).toBe(404);
    expect((await post(rep().token, { ...base, subjectType: 'order', subjectId: pair.b.ids.order })).status).toBe(404);
    expect((await post(rep().token, { ...base, subjectType: 'customer', subjectId: pair.b.ids.customer })).status).toBe(404);
    expect((await post(rep().token, { ...base, subjectType: 'product', subjectId: pair.b.ids.product })).status).toBe(404);
    expect((await post(rep().token, { ...base, subjectType: 'payout', subjectId: pair.b.ids.payout })).status).toBe(404);
    expect((await post(rep2.token, { ...base, subjectType: 'order', subjectId: pair.a.ids.order })).status).toBe(403);
    expect((await post(owner().token, { ...base, subjectType: 'order', subjectId: pair.a.ids.order })).status).toBe(201);
    expect((await post(owner().token, { ...base, subjectType: 'customer', subjectId: pair.a.ids.customer })).status).toBe(201);
    expect((await post(owner().token, { ...base, subjectType: 'payout', subjectId: pair.a.ids.payout })).status).toBe(201);
    expect((await post(owner().token, { ...base, subjectType: 'product', subjectId: pair.a.ids.product })).status).toBe(201);
  });

  it('a person of another tenant or a deactivated person cannot be the assignee', async () => {
    const base = { note: 'n', dueAt: iso(HOUR) };
    expect((await post(owner().token, { ...base, assignedToId: pair.b.users.salesRep.id })).status).toBe(400);
    await prismaBase.user.update({ where: { id: rep2.id }, data: { isActive: false } });
    expect((await post(owner().token, { ...base, assignedToId: rep2.id })).status).toBe(400);
    await prismaBase.user.update({ where: { id: rep2.id }, data: { isActive: true } });
    expect((await post(owner().token, { ...base, assignedToId: rep2.id })).status).toBe(201);
  });
});

describe('list, patch, delete', () => {
  it('lists mine by status; the owner sees all, a rep only their own; other tenant never', async () => {
    const mine = await seed({ dueAt: new Date(Date.now() + HOUR) });
    const sent = await seed({ status: 'sent', sentAt: new Date() });
    const theirs = await seed({ createdById: rep2.id, assignedToId: rep2.id, dueAt: new Date(Date.now() + HOUR) });
    const other = await prismaBase.reminder.create({
      data: { tenantId: pair.b.id, createdById: pair.b.users.admin.id, assignedToId: pair.b.users.admin.id, note: 'b', dueAt: new Date(Date.now() + HOUR) },
    });
    const ids = async (token: string, qs = '') => (await request(app).get(`/api/reminders${qs}`).set(auth(token))).body.reminders.map((r: any) => r.id).sort();
    expect(await ids(rep().token)).toEqual([mine.id, sent.id].sort());
    expect(await ids(rep().token, '?status=pending')).toEqual([mine.id]);
    expect(await ids(rep().token, '?status=sent&mine=1')).toEqual([sent.id]);
    expect(await ids(owner().token)).toEqual([mine.id, sent.id, theirs.id].sort());
    expect(await ids(owner().token, '?mine=1')).toEqual([]);
    expect(await ids(owner().token)).not.toContain(other.id);
    expect((await request(app).get('/api/reminders?status=nope').set(auth(rep().token))).status).toBe(400);
  });

  it('the creator, the assignee, an admin and the owner may change; another rep may not; another tenant gets 404', async () => {
    const r = await seed({ createdById: rep().id, assignedToId: rep2.id, dueAt: new Date(Date.now() + HOUR) });
    const patch = (token: string, body: object) => request(app).patch(`/api/reminders/${r.id}`).set(auth(token)).send(body);
    expect((await patch(rep().token, { note: 'by creator' })).body.reminder.note).toBe('by creator');
    expect((await patch(rep2.token, { note: 'by assignee' })).body.reminder.note).toBe('by assignee');
    expect((await patch(owner().token, { dueAt: iso(2 * HOUR) })).status).toBe(200);
    const stranger = await mkUser(pair.a.id, 'stranger', 'sales_rep');
    expect((await patch(stranger.token, { note: 'no' })).status).toBe(403);
    expect((await patch(pair.b.users.admin.token, { note: 'no' })).status).toBe(404);
    expect((await patch(rep().token, { dueAt: iso(-1000) })).status).toBe(400);
    expect((await patch(rep().token, {})).status).toBe(400);
  });

  it('DELETE cancels (the row stays); a cancelled reminder never fires and cannot change', async () => {
    const r = await seed();
    const res = await request(app).delete(`/api/reminders/${r.id}`).set(auth(rep().token));
    expect(res.status).toBe(200);
    expect(res.body.reminder.status).toBe('cancelled');
    expect(await processDueReminders()).toBe(0);
    expect(await inboxRows(rep().id)).toHaveLength(0);
    expect((await request(app).patch(`/api/reminders/${r.id}`).set(auth(rep().token)).send({ note: 'x' })).status).toBe(409);
    expect((await request(app).delete(`/api/reminders/${r.id}`).set(auth(rep2.token))).status).toBe(403);
  });
});

describe('due job', () => {
  it('fires a due reminder once, to the assignee, with the subject; a future one waits', async () => {
    const due = await seed({ subjectType: 'order', subjectId: pair.a.ids.order, assignedToId: rep().id, createdById: owner().id });
    const later = await seed({ dueAt: new Date(Date.now() + HOUR) });
    expect(await processDueReminders()).toBe(1);
    expect(await processDueReminders()).toBe(0); // a second tick sends nothing
    const rows = await inboxRows(rep().id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'reminder', subjectType: 'order', subjectId: pair.a.ids.order, message: 'Call the customer', isRead: false });
    expect((await prismaBase.reminder.findUniqueOrThrow({ where: { id: due.id } })).status).toBe('sent');
    expect((await prismaBase.reminder.findUniqueOrThrow({ where: { id: due.id } })).sentAt).not.toBeNull();
    expect((await prismaBase.reminder.findUniqueOrThrow({ where: { id: later.id } })).status).toBe('pending');
    // it shows in the Reminders view of the feed
    const feed = await request(app).get('/api/inbox?view=reminders').set(auth(rep().token));
    expect(feed.body.items).toHaveLength(1);
  });

  it('claim once: ten ticks at the same moment send exactly one notification', async () => {
    await seed();
    const results = await Promise.all(Array.from({ length: 10 }, () => processDueReminders()));
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await inboxRows(rep().id)).toHaveLength(1);
  });

  it('fires on a real Bull queue, once, even when two jobs run at the same time', async () => {
    await seed();
    const name = `reminders-due-test-${Date.now()}`;
    const queue = new Bull(name, { redis: { host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379), password: process.env.REDIS_PASSWORD } });
    try {
      queue.process(REMINDER_DUE_JOB, 2, processReminderJob);
      const jobs = await Promise.all([queue.add(REMINDER_DUE_JOB, {}), queue.add(REMINDER_DUE_JOB, {})]);
      const sent = await Promise.all(jobs.map((j) => j.finished()));
      expect((sent as number[]).reduce((a, b) => a + b, 0)).toBe(1);
      expect(await inboxRows(rep().id)).toHaveLength(1);
    } finally {
      await queue.empty();
      await queue.close();
    }
  }, 20000);

  it('restart: a reminder that fell due while the server was down goes out on the first tick after the restart', async () => {
    const redis = { host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379), password: process.env.REDIS_PASSWORD };
    const name = `reminders-restart-test-${Date.now()}`;
    // 1. the server runs and the reminder is not due yet
    await seed({ dueAt: new Date(Date.now() + 1500) });
    let queue = new Bull(name, { redis });
    queue.process(REMINDER_DUE_JOB, processReminderJob);
    expect(await (await queue.add(REMINDER_DUE_JOB, {})).finished()).toBe(0);
    // 2. the server goes down; the due time passes with no worker alive
    await queue.close();
    await new Promise((r) => setTimeout(r, 1700));
    expect(await inboxRows(rep().id)).toHaveLength(0);
    // 3. the server starts again; the first tick reads the database and sends it
    queue = new Bull(name, { redis });
    try {
      queue.process(REMINDER_DUE_JOB, processReminderJob);
      expect(await (await queue.add(REMINDER_DUE_JOB, {})).finished()).toBe(1);
      expect(await (await queue.add(REMINDER_DUE_JOB, {})).finished()).toBe(0);
      expect(await inboxRows(rep().id)).toHaveLength(1);
    } finally {
      await queue.empty();
      await queue.close();
    }
  }, 25000);

  it('a deactivated assignee: it goes to the creator with the note; both deactivated: to the owner', async () => {
    const gone = await mkUser(pair.a.id, 'gone', 'sales_rep');
    const creator = await mkUser(pair.a.id, 'creator', 'sales_rep');
    await seed({ createdById: creator.id, assignedToId: gone.id, note: 'Collect cash' });
    await prismaBase.user.update({ where: { id: gone.id }, data: { isActive: false } });
    await processDueReminders();
    const toCreator = await inboxRows(creator.id);
    expect(toCreator).toHaveLength(1);
    expect(toCreator[0].message).toContain('is deactivated; this reminder came to you');
    expect(toCreator[0].message).toContain('Collect cash');
    expect(await inboxRows(gone.id)).toHaveLength(0);

    await seed({ createdById: creator.id, assignedToId: gone.id, note: 'Second' });
    await prismaBase.user.update({ where: { id: creator.id }, data: { isActive: false } });
    await processDueReminders();
    const toOwner = await inboxRows(owner().id);
    expect(toOwner.some((n) => n.message.includes('Second'))).toBe(true);
  });

  it('an external channel that is not connected falls back to in-app only: the row is written and nothing is sent', async () => {
    const sms = jest.spyOn(smsService, 'sendSms').mockResolvedValue({} as never);
    const wa = jest.spyOn(whatsappService, 'sendText').mockResolvedValue({} as never);
    const mail = jest.spyOn(emailService, 'sendEmail').mockResolvedValue(undefined as never);
    // This tenant has no email config; the env keys would make email count as connected
    const keys = { resend: process.env.RESEND_API_KEY, sendgrid: process.env.SENDGRID_API_KEY };
    delete process.env.RESEND_API_KEY;
    delete process.env.SENDGRID_API_KEY;
    await prismaBase.notificationPreference.create({
      data: { tenantId: pair.a.id, userId: rep().id, event: 'reminder_due', inApp: true, email: true, sms: true, whatsapp: true },
    });
    await seed();
    try {
      await processDueReminders();
    } finally {
      if (keys.resend !== undefined) process.env.RESEND_API_KEY = keys.resend;
      if (keys.sendgrid !== undefined) process.env.SENDGRID_API_KEY = keys.sendgrid;
    }
    expect(await inboxRows(rep().id)).toHaveLength(1);
    expect(sms).not.toHaveBeenCalled();
    expect(wa).not.toHaveBeenCalled();
    expect(mail).not.toHaveBeenCalled();
  });

  it('two tenants: each reminder goes only to its own tenant', async () => {
    await seed({ note: 'tenant A' });
    await prismaBase.reminder.create({
      data: { tenantId: pair.b.id, createdById: pair.b.users.salesRep.id, assignedToId: pair.b.users.salesRep.id, note: 'tenant B', dueAt: new Date(Date.now() - 1000) },
    });
    expect(await processDueReminders()).toBe(2);
    expect((await inboxRows(rep().id)).map((n) => n.message)).toEqual(['tenant A']);
    expect((await inboxRows(pair.b.users.salesRep.id)).map((n) => n.message)).toEqual(['tenant B']);
  });
});
