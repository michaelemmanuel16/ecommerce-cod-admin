/**
 * M9-T17 (COD-80): the inbox feed API. Views, paging, done, snooze, mark all, counts from the database,
 * deleted subjects, "assigned to me", per-person scope, two tenants, and tenant scoped socket rooms.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { io as connect, Socket } from 'socket.io-client';
import { Server as SocketServer } from 'socket.io';
import { NotificationKind } from '@prisma/client';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { initializeSocket, emitOrderUpdated } from '../../sockets';
import { setSocketInstance } from '../../utils/socketInstance';
import { runInTenant } from '../../utils/tenantContext';
import { roomNames } from '../../sockets/rooms';
import { notify } from '../../services/inbox/inboxService';
import { createTwoTenants, mkUser, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
let rep2: { id: number; token: string };
let server: http.Server;
let io: SocketServer;
let url: string;
const clients: Socket[] = [];
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const get = (token: string, path: string) => request(app).get(path).set(auth(token));
const feed = async (token: string, qs = '') => (await get(token, `/api/inbox${qs}`)).body;
const counts = async (token: string) => (await get(token, '/api/inbox/counts')).body.counts;

let seq = 0;
const T0 = Date.now() - 3 * 24 * 3600 * 1000;
/** A row written straight to the database with a controlled time (newest = highest seq). */
async function row(tenantId: string, userId: number, kind: NotificationKind, extra: Record<string, unknown> = {}) {
  seq++;
  return prismaBase.notification.create({
    data: {
      tenantId, userId, kind, type: kind === 'alert' ? 'late_callback' : kind === 'reply' ? 'customer_reply' : 'team_note',
      title: `T${seq}`, message: `M${seq}`, createdAt: new Date(T0 + seq * 1000), ...extra,
    },
  });
}

const open = async (token: string): Promise<Socket> => {
  const s = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
  clients.push(s);
  await new Promise<void>((resolve, reject) => { s.on('connect', () => resolve()); s.on('connect_error', reject); });
  return s;
};
const collect = (s: Socket, event: string) => { const got: any[] = []; s.on(event, (d) => got.push(d)); return got; };
const until = async (cond: () => boolean) => {
  for (let waited = 0; !cond() && waited < 2000; waited += 5) await new Promise((r) => setTimeout(r, 5));
  expect(cond()).toBe(true);
};
const settle = () => new Promise((r) => setTimeout(r, 150));

beforeAll(async () => {
  pair = await createTwoTenants('inboxfeed');
  rep2 = await mkUser(pair.a.id, 'rep2', 'sales_rep');
  mgrUser = await mkUser(pair.a.id, 'mgr', 'manager');
  server = http.createServer();
  io = initializeSocket(server);
  setSocketInstance(io);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://localhost:${(server.address() as AddressInfo).port}`;
}, 30000);

afterAll(async () => {
  clients.forEach((c) => c.close());
  io.close();
  await prismaBase.conversation.deleteMany({ where: { tenantId: pair.a.id } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

const rep = () => pair.a.users.salesRep;
const owner = () => pair.a.users.admin;
// The feed mechanics below run as a manager: a call rep has a narrower Inbox (inboxRepFilter.test.ts, repAgentInbox.test.ts)
let mgrUser: { id: number; token: string };
const mgr = () => mgrUser;

beforeEach(async () => {
  await prismaBase.notification.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
});

describe('GET /api/inbox', () => {
  it('requires a sign-in and validates the query', async () => {
    expect((await request(app).get('/api/inbox')).status).toBe(401);
    expect((await get(rep().token, '/api/inbox?view=nope')).status).toBe(400);
    expect((await get(rep().token, '/api/inbox?status=nope')).status).toBe(400);
    expect((await get(rep().token, '/api/inbox?cursor=%%%')).status).toBeGreaterThanOrEqual(400);
  });

  it('views filter by kind, newest first', async () => {
    const a1 = await row(pair.a.id, mgr().id, 'alert');
    const r1 = await row(pair.a.id, mgr().id, 'reply');
    const m1 = await row(pair.a.id, mgr().id, 'mention');
    const d1 = await row(pair.a.id, mgr().id, 'reminder');
    const n1 = await row(pair.a.id, mgr().id, 'note');
    const a2 = await row(pair.a.id, mgr().id, 'alert');
    const ids = async (view: string) => (await feed(mgr().token, `?view=${view}`)).items.map((i: any) => i.id);
    expect(await ids('all')).toEqual([a2.id, n1.id, d1.id, m1.id, r1.id, a1.id]);
    expect(await ids('alerts')).toEqual([a2.id, a1.id]);
    expect(await ids('replies')).toEqual([r1.id]);
    expect(await ids('mentions')).toEqual([m1.id]);
    expect(await ids('reminders')).toEqual([d1.id]);
    expect(await ids('notes')).toEqual([n1.id]);
  });

  it('still lists rows stored under event names that were removed (agent_unblocked, workflow_failed, connection_error)', async () => {
    const made = [];
    for (const type of ['agent_unblocked', 'workflow_failed', 'connection_error']) {
      made.push(await row(pair.a.id, mgr().id, 'alert', { type }));
    }
    const res = await get(mgr().token, '/api/inbox');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.id)).toEqual([...made].reverse().map((m) => m.id));
    const read = await request(app).patch(`/api/inbox/${made[0].id}`).set(auth(mgr().token)).send({ read: true });
    expect(read.status).toBe(200);
  });

  it('pages with a cursor, newest first, with no gap and no repeat', async () => {
    const made = [];
    for (let i = 0; i < 7; i++) made.push((await row(pair.a.id, mgr().id, 'alert')).id);
    const seen: number[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const body: any = await feed(mgr().token, `?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...body.items.map((i: any) => i.id));
      cursor = body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual([...made].reverse());
  });

  it('rows with the same time page in id order', async () => {
    const t = new Date(T0 + 999000);
    const a = await row(pair.a.id, mgr().id, 'alert', { createdAt: t });
    const b = await row(pair.a.id, mgr().id, 'alert', { createdAt: t });
    const c = await row(pair.a.id, mgr().id, 'alert', { createdAt: t });
    const p1 = await feed(mgr().token, '?limit=2');
    const p2 = await feed(mgr().token, `?limit=2&cursor=${p1.nextCursor}`);
    expect([...p1.items, ...p2.items].map((i: any) => i.id)).toEqual([c.id, b.id, a.id]);
    expect(p2.nextCursor).toBeNull();
  });

  it('assigned: only rows whose subject is assigned to me', async () => {
    const mine = await row(pair.a.id, rep().id, 'alert', { subjectType: 'order', subjectId: pair.a.ids.order });
    await row(pair.a.id, rep().id, 'alert'); // no subject
    await row(pair.a.id, owner().id, 'alert', { subjectType: 'order', subjectId: pair.a.ids.order }); // the owner's own row
    const conv = await prismaBase.conversation.create({
      data: { tenantId: pair.a.id, channel: 'whatsapp', phone: `+2330000${Date.now() % 100000}`, assignedToId: rep().id, lastMessageAt: new Date() },
    });
    const other = await prismaBase.conversation.create({
      data: { tenantId: pair.a.id, channel: 'whatsapp', phone: `+2339999${Date.now() % 100000}`, assignedToId: rep2.id, lastMessageAt: new Date() },
    });
    const mineConv = await row(pair.a.id, rep().id, 'reply', { subjectType: 'conversation', subjectId: conv.id });
    await row(pair.a.id, rep().id, 'reply', { subjectType: 'conversation', subjectId: other.id });

    const repView = (await feed(rep().token, '?view=assigned')).items.map((i: any) => i.id);
    expect(repView.sort()).toEqual([mine.id, mineConv.id].sort());
    // the owner holds no order and no conversation: nothing is assigned to them
    expect((await feed(owner().token, '?view=assigned')).items).toEqual([]);
    expect((await counts(rep().token)).assigned).toBe(2);
    await prismaBase.conversation.deleteMany({ where: { id: { in: [conv.id, other.id] } } });
  });

  it('a deleted subject says subjectDeleted; a live one does not; one read per subject type', async () => {
    const live = await row(pair.a.id, mgr().id, 'alert', { subjectType: 'order', subjectId: pair.a.ids.order });
    const gone = await row(pair.a.id, mgr().id, 'alert', { subjectType: 'customer', subjectId: 999999999 });
    const customerLive = await row(pair.a.id, mgr().id, 'alert', { subjectType: 'customer', subjectId: pair.a.ids.customer });
    const conn = await row(pair.a.id, mgr().id, 'system', { subjectType: 'connection', subjectId: 3 });
    const none = await row(pair.a.id, mgr().id, 'note');
    const body = await feed(mgr().token);
    const by = Object.fromEntries(body.items.map((i: any) => [i.id, i]));
    expect(by[live.id]).toMatchObject({ subject: { type: 'order', id: pair.a.ids.order }, subjectDeleted: false });
    expect(by[gone.id]).toMatchObject({ subject: { type: 'customer', id: 999999999 }, subjectDeleted: true });
    expect(by[customerLive.id].subjectDeleted).toBe(false);
    expect(by[conn.id].subjectDeleted).toBe(false);
    expect(by[none.id]).toMatchObject({ subject: null, subjectDeleted: false });
  });

  it('a subject in the other tenant counts as deleted, never a link into it', async () => {
    const r = await row(pair.a.id, mgr().id, 'alert', { subjectType: 'order', subjectId: pair.b.ids.order });
    const item = (await feed(mgr().token)).items.find((i: any) => i.id === r.id);
    expect(item.subjectDeleted).toBe(true);
  });
});

describe('PATCH /api/inbox/:id', () => {
  it('read and unread', async () => {
    const r = await row(pair.a.id, mgr().id, 'reply');
    const res = await request(app).patch(`/api/inbox/${r.id}`).set(auth(mgr().token)).send({ read: true });
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ id: r.id, isRead: true });
    expect(res.body.item.readAt).toBeTruthy();
    expect(res.body.counts.all).toBe(0);
    const back = await request(app).patch(`/api/inbox/${r.id}`).set(auth(mgr().token)).send({ read: false });
    expect(back.body.item).toMatchObject({ isRead: false, readAt: null });
    expect(back.body.counts.all).toBe(1);
  });

  it('done moves the row out of Open and into Done, and reads it', async () => {
    const r = await row(pair.a.id, mgr().id, 'alert');
    const res = await request(app).patch(`/api/inbox/${r.id}`).set(auth(mgr().token)).send({ done: true });
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({ isRead: true });
    expect(res.body.item.doneAt).toBeTruthy();
    expect((await feed(mgr().token, '?status=open')).items).toEqual([]);
    expect((await feed(mgr().token, '?status=done')).items.map((i: any) => i.id)).toEqual([r.id]);
    expect((await counts(mgr().token)).all).toBe(0);
    await request(app).patch(`/api/inbox/${r.id}`).set(auth(mgr().token)).send({ done: false });
    expect((await feed(mgr().token, '?status=open')).items.map((i: any) => i.id)).toEqual([r.id]);
  });

  it('snooze takes a future time only; the row leaves Open until the time passes', async () => {
    const r = await row(pair.a.id, mgr().id, 'reply');
    const past = await request(app).patch(`/api/inbox/${r.id}`).set(auth(mgr().token)).send({ snoozedUntil: new Date(Date.now() - 1000).toISOString() });
    expect(past.status).toBe(400);
    const bad = await request(app).patch(`/api/inbox/${r.id}`).set(auth(mgr().token)).send({ snoozedUntil: 'tomorrow' });
    expect(bad.status).toBe(400);

    const until = new Date(Date.now() + 3600 * 1000).toISOString();
    const ok = await request(app).patch(`/api/inbox/${r.id}`).set(auth(mgr().token)).send({ snoozedUntil: until });
    expect(ok.status).toBe(200);
    expect((await feed(mgr().token, '?status=open')).items).toEqual([]);
    expect((await feed(mgr().token, '?status=snoozed')).items.map((i: any) => i.id)).toEqual([r.id]);
    // a snoozed reply is not counted while it sleeps
    expect((await counts(mgr().token)).replies).toBe(0);

    // time passes: the row is back in Open and counted
    await prismaBase.notification.update({ where: { id: r.id }, data: { snoozedUntil: new Date(Date.now() - 1000) } });
    expect((await feed(mgr().token, '?status=open')).items.map((i: any) => i.id)).toEqual([r.id]);
    expect((await counts(mgr().token)).replies).toBe(1);

    // clearing the snooze
    await request(app).patch(`/api/inbox/${r.id}`).set(auth(mgr().token)).send({ snoozedUntil: until });
    const cleared = await request(app).patch(`/api/inbox/${r.id}`).set(auth(mgr().token)).send({ snoozedUntil: null });
    expect(cleared.body.item.snoozedUntil).toBeNull();
  });

  it('a snoozed Alert still counts in Alerts, but is out of the Open list', async () => {
    const a = await row(pair.a.id, mgr().id, 'alert');
    await request(app).patch(`/api/inbox/${a.id}`).set(auth(mgr().token)).send({ snoozedUntil: new Date(Date.now() + 3600 * 1000).toISOString() });
    expect((await feed(mgr().token, '?view=alerts&status=open')).items).toEqual([]);
    expect((await counts(mgr().token)).alerts).toBe(1);
    expect((await counts(mgr().token)).all).toBe(1);
  });

  it('needs at least one field, and a numeric id', async () => {
    const r = await row(pair.a.id, mgr().id, 'reply');
    expect((await request(app).patch(`/api/inbox/${r.id}`).set(auth(mgr().token)).send({})).status).toBe(400);
    expect((await request(app).patch('/api/inbox/abc').set(auth(mgr().token)).send({ read: true })).status).toBe(400);
  });

  it('404 for a row of another person, the owner included, and for another tenant', async () => {
    const r = await row(pair.a.id, rep().id, 'reply');
    expect((await request(app).patch(`/api/inbox/${r.id}`).set(auth(rep2.token)).send({ read: true })).status).toBe(404);
    expect((await request(app).patch(`/api/inbox/${r.id}`).set(auth(owner().token)).send({ read: true })).status).toBe(404);
    expect((await request(app).patch(`/api/inbox/${r.id}`).set(auth(pair.b.users.admin.token)).send({ read: true })).status).toBe(404);
    expect((await prismaBase.notification.findUniqueOrThrow({ where: { id: r.id } })).isRead).toBe(false);
  });
});

describe('POST /api/inbox/mark-all', () => {
  it('marks only the chosen view, only my rows, and leaves done and others alone', async () => {
    const m1 = await row(pair.a.id, mgr().id, 'mention');
    const m2 = await row(pair.a.id, mgr().id, 'mention');
    const a1 = await row(pair.a.id, mgr().id, 'alert');
    const other = await row(pair.a.id, rep2.id, 'mention');
    const res = await request(app).post('/api/inbox/mark-all').set(auth(mgr().token)).send({ view: 'mentions' });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);
    expect(res.body.counts).toMatchObject({ mentions: 0, alerts: 1, all: 1 });
    const state = async (id: number) => (await prismaBase.notification.findUniqueOrThrow({ where: { id } })).isRead;
    expect([await state(m1.id), await state(m2.id), await state(a1.id), await state(other.id)]).toEqual([true, true, false, false]);

    const all = await request(app).post('/api/inbox/mark-all').set(auth(mgr().token)).send({});
    expect(all.body.updated).toBe(1);
    expect((await counts(mgr().token)).all).toBe(0);
    expect((await request(app).post('/api/inbox/mark-all').set(auth(mgr().token)).send({ view: 'nope' })).status).toBe(400);
  });
});

describe('GET /api/inbox/counts', () => {
  it('counts unread per view from the database, with no socket involved', async () => {
    await row(pair.a.id, mgr().id, 'alert');
    await row(pair.a.id, mgr().id, 'alert', { isRead: true });
    await row(pair.a.id, mgr().id, 'reply');
    await row(pair.a.id, mgr().id, 'mention');
    await row(pair.a.id, mgr().id, 'reminder');
    await row(pair.a.id, mgr().id, 'note');
    await row(pair.a.id, mgr().id, 'note', { doneAt: new Date(), isRead: true });
    await row(pair.a.id, rep2.id, 'alert'); // someone else's
    expect(await counts(mgr().token)).toEqual({ all: 5, alerts: 1, replies: 1, mentions: 1, reminders: 1, notes: 1, assigned: 0 });
    // the counts also work while io is gone
    setSocketInstance(null as any);
    expect((await counts(mgr().token)).all).toBe(5);
    setSocketInstance(io);
  });

  it('requires a sign-in', async () => {
    expect((await request(app).get('/api/inbox/counts')).status).toBe(401);
  });
});

describe('scope: each person sees only their own rows', () => {
  it('a rep never sees another rep\'s rows and cannot ask for scope=all', async () => {
    // a team note on a customer is a row a rep sees; a bare customer_reply (no conversation) is not
    const mine = await row(pair.a.id, rep().id, 'note');
    const theirs = await row(pair.a.id, rep2.id, 'note');
    const items = (await feed(rep().token)).items.map((i: any) => i.id);
    expect(items).toEqual([mine.id]);
    expect(items).not.toContain(theirs.id);
    expect((await get(rep().token, '/api/inbox?scope=all')).status).toBe(403);
    expect((await get(rep2.token, '/api/inbox?scope=all')).status).toBe(403);
    expect((await feed(rep2.token)).items.map((i: any) => i.id)).toEqual([theirs.id]);
  });

  it('the owner sees their own rows by default and every row of the tenant with scope=all, never the other tenant', async () => {
    const own = await row(pair.a.id, owner().id, 'alert');
    const repRow = await row(pair.a.id, rep().id, 'reply');
    const bRow = await row(pair.b.id, pair.b.users.admin.id, 'alert');
    expect((await feed(owner().token)).items.map((i: any) => i.id)).toEqual([own.id]);
    const all = (await feed(owner().token, '?scope=all')).items.map((i: any) => i.id);
    expect(all.sort()).toEqual([own.id, repRow.id].sort());
    expect(all).not.toContain(bRow.id);
    // another tenant's owner sees only their tenant
    expect((await feed(pair.b.users.admin.token, '?scope=all')).items.map((i: any) => i.id)).toEqual([bRow.id]);
    expect((await counts(owner().token)).all).toBe(1);
  });
});

describe('legacy /api/notifications routes still work, through the same rows', () => {
  it('list, unread-count, mark one read, mark all read', async () => {
    const r1 = await row(pair.a.id, mgr().id, 'reply');
    await row(pair.a.id, mgr().id, 'alert');
    const list = await get(mgr().token, '/api/notifications');
    expect(list.status).toBe(200);
    expect(list.body.notifications).toHaveLength(2);
    expect(list.body.unreadCount).toBe(2);
    expect((await get(mgr().token, '/api/notifications/unread-count')).body).toEqual({ unreadCount: 2 });
    const one = await request(app).patch(`/api/notifications/${r1.id}/read`).set(auth(mgr().token));
    expect(one.status).toBe(200);
    expect((await get(mgr().token, '/api/notifications/unread-count')).body).toEqual({ unreadCount: 1 });
    expect((await request(app).patch('/api/notifications/read-all').set(auth(mgr().token))).status).toBe(200);
    expect((await get(mgr().token, '/api/notifications/unread-count')).body).toEqual({ unreadCount: 0 });
    // not someone else's row
    const other = await row(pair.a.id, rep2.id, 'reply');
    expect((await request(app).patch(`/api/notifications/${other.id}/read`).set(auth(mgr().token))).status).toBe(404);
  });
});

describe('socket: inbox:new and inbox:counts', () => {
  it('reach only the room of the person the row is for', async () => {
    const sRep = await open(mgr().token);
    const sRep2 = await open(rep2.token);
    const sOwner = await open(owner().token);
    const sB = await open(pair.b.users.admin.token);
    const news = [sRep, sRep2, sOwner, sB].map((s) => collect(s, 'inbox:new'));
    const cnt = [sRep, sRep2, sOwner, sB].map((s) => collect(s, 'inbox:counts'));

    await notify({
      tenantId: pair.a.id, event: 'customer_reply', subject: { type: 'order', id: pair.a.ids.order },
      recipients: [mgr().id], title: 'Reply', message: 'hello',
    });
    await until(() => news[0].length === 1 && cnt[0].length === 1);
    await settle();

    expect(news[0][0]).toMatchObject({ title: 'Reply', kind: 'reply', event: 'customer_reply', subjectDeleted: false });
    expect(cnt[0][0]).toMatchObject({ all: 1, replies: 1 });
    for (const i of [1, 2, 3]) {
      expect(news[i]).toHaveLength(0);
      expect(cnt[i]).toHaveLength(0);
    }

    // a change from the API pushes fresh counts to the same person only
    const id = news[0][0].id;
    await request(app).patch(`/api/inbox/${id}`).set(auth(mgr().token)).send({ done: true });
    await until(() => cnt[0].length === 2);
    expect(cnt[0][1]).toMatchObject({ all: 0 });
    expect(cnt[1]).toHaveLength(0);
  });

  it('rooms are tenant scoped: a tenant A socket is in no tenant B room, and cannot join one', async () => {
    const sA = await open(rep().token);
    const sB = await open(pair.b.users.salesRep.token);
    const got = collect(sA, 'order:updated');
    // a client asking for another tenant's order room, or any room by name, gets nothing
    sA.emit('join:order', String(pair.b.ids.order));
    sA.emit('join', roomNames.user(pair.b.id, pair.b.users.salesRep.id));
    sA.emit('join:room', roomNames.tenant(pair.b.id));
    await settle();

    await runInTenant(pair.b.id, async () => emitOrderUpdated(io, { id: pair.b.ids.order, tenantId: pair.b.id, customerRepId: pair.b.users.salesRep.id }));
    await settle();
    expect(got).toHaveLength(0);

    for (const room of [roomNames.tenant(pair.b.id), roomNames.user(pair.b.id, pair.b.users.salesRep.id), roomNames.order(pair.b.id, pair.b.ids.order)]) {
      const members = await io.in(room).fetchSockets();
      expect(members.every((m) => (m.data.user as any).tenantId === pair.b.id)).toBe(true);
    }
    const aRooms = await io.in(roomNames.tenant(pair.a.id)).fetchSockets();
    for (const m of aRooms) {
      expect([...m.rooms].filter((r) => r !== m.id).every((r) => r.startsWith(`t:${pair.a.id}`))).toBe(true);
    }
    expect(sB.connected).toBe(true);
  });
});
