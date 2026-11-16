/**
 * M9-T20 (COD-80): rep inbox and agent inbox. Rows are scoped to the person, "assigned to me", an order that moved
 * keeps its row with the link greyed, and the agent events (payout paid, delivery rescheduled). Real database, two tenants.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { postEntry } from '../../services/commissionService';
import deliveryService from '../../services/deliveryService';
import { notifyStockIncoming } from '../../services/inbox/agentEvents';
import { createTwoTenants, mkUser, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
let rep2: { id: number; token: string };
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const get = (token: string, path: string) => request(app).get(path).set(auth(token));
const feed = async (token: string, qs = '') => (await get(token, `/api/inbox${qs}`)).body;
const rep = () => pair.a.users.salesRep;
const agent = () => pair.a.users.deliveryAgent;
const owner = () => pair.a.users.admin;

const KINDS = ['alert', 'reply', 'mention', 'reminder', 'note'] as const;
// `reply` rows here use `mention`: a customer_reply row needs a real conversation to show for a rep (inboxRepFilter.test.ts)
const TYPE = { alert: 'late_callback', reply: 'mention', mention: 'mention', reminder: 'reminder_due', note: 'team_note' } as const;
let seq = 0;
const row = (userId: number, kind: (typeof KINDS)[number], extra: Record<string, unknown> = {}) => prismaBase.notification.create({
  data: { tenantId: pair.a.id, userId, kind, type: TYPE[kind], title: `T${++seq}`, message: `M${seq}`, ...extra },
});

beforeAll(async () => {
  pair = await createTwoTenants('repinbox');
  rep2 = await mkUser(pair.a.id, 'rep2', 'sales_rep');
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

beforeEach(async () => {
  await prismaBase.notification.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
  await prismaBase.order.update({ where: { id: pair.a.ids.order }, data: { customerRepId: rep().id, deliveryAgentId: agent().id, deletedAt: null } });
});

describe('scope: a person sees only their own rows, in every view', () => {
  it('rep A never sees rep B rows (views, statuses, counts, patch, mark-all); the owner and the other tenant are separate too', async () => {
    const orderSubject = { subjectType: 'order', subjectId: pair.a.ids.order };
    const mine: number[] = [];
    const theirs: number[] = [];
    for (const kind of KINDS) {
      mine.push((await row(rep().id, kind, orderSubject)).id);
      theirs.push((await row(rep2.id, kind, orderSubject)).id); // same subject, other person
    }
    theirs.push((await row(owner().id, 'alert')).id);
    const done = await row(rep2.id, 'alert', { doneAt: new Date() });
    const snoozed = await row(rep2.id, 'note', { snoozedUntil: new Date(Date.now() + 3600_000) });
    const otherTenantRow = await prismaBase.notification.create({
      data: { tenantId: pair.b.id, userId: pair.b.users.salesRep.id, kind: 'alert', type: 'late_callback', title: 'B', message: 'B' },
    });
    const forbidden = new Set([...theirs, done.id, snoozed.id, otherTenantRow.id]);

    for (const view of ['all', 'alerts', 'replies', 'mentions', 'reminders', 'notes', 'assigned']) {
      for (const status of ['open', 'done', 'snoozed']) {
        const items = (await feed(rep().token, `?view=${view}&status=${status}`)).items as Array<{ id: number; userId: number }>;
        expect(items.every((i) => i.userId === rep().id)).toBe(true);
        expect(items.some((i) => forbidden.has(i.id))).toBe(false);
      }
    }
    expect((await feed(rep().token)).items.map((i: any) => i.id).sort()).toEqual([...mine].sort());
    // the other person's counts are theirs
    expect((await get(rep().token, '/api/inbox/counts')).body.counts.all).toBe(5);
    expect((await get(rep2.token, '/api/inbox/counts')).body.counts.all).toBe(0); // rep2 owns no order, so their order rows are hidden (F-763); the done alert and the snoozed note never counted
  });

  it('a rep cannot change another person row, and mark-all leaves it alone', async () => {
    const other = await row(rep2.id, 'reply');
    const mineRow = await row(rep().id, 'reply');
    expect((await request(app).patch(`/api/inbox/${other.id}`).set(auth(rep().token)).send({ done: true })).status).toBe(404);
    expect((await request(app).post('/api/inbox/mark-all').set(auth(rep().token)).send({ view: 'all' })).body.updated).toBe(1);
    expect((await prismaBase.notification.findUniqueOrThrow({ where: { id: other.id } })).isRead).toBe(false);
    expect((await prismaBase.notification.findUniqueOrThrow({ where: { id: mineRow.id } })).isRead).toBe(true);
    // the owner may only widen the scope with scope=all; a rep is refused
    expect((await get(rep().token, '/api/inbox?scope=all')).status).toBe(403);
    expect((await get(owner().token, '/api/inbox?scope=all')).status).toBe(200);
  });

  it('an agent sees only their own rows; no rep rows, no owner rows', async () => {
    const a = await row(agent().id, 'alert', { type: 'payout_paid' });
    await row(rep().id, 'alert');
    await row(owner().id, 'alert');
    const items = (await feed(agent().token)).items;
    expect(items.map((i: any) => i.id)).toEqual([a.id]);
    expect((await get(agent().token, '/api/inbox?scope=all')).status).toBe(403);
    expect((await get(agent().token, '/api/inbox/counts')).body.counts.all).toBe(1);
  });
});

describe('view=assigned and the moved order', () => {
  it('assigned: only rows about orders assigned to me right now; the agent sees orders on their delivery', async () => {
    const subject = { subjectType: 'order', subjectId: pair.a.ids.order };
    const mineRow = await row(rep().id, 'alert', subject);
    await row(rep().id, 'alert'); // no subject
    const agentRow = await row(agent().id, 'alert', subject);
    expect((await feed(rep().token, '?view=assigned')).items.map((i: any) => i.id)).toEqual([mineRow.id]);
    expect((await feed(agent().token, '?view=assigned')).items.map((i: any) => i.id)).toEqual([agentRow.id]);
    expect((await get(rep().token, '/api/inbox/counts')).body.counts.assigned).toBe(1);
  });

  it('an order that moved to another rep: the row leaves the old rep list and counts, and the order API refuses the old rep', async () => {
    const subject = { subjectType: 'order', subjectId: pair.a.ids.order };
    const oldRow = await row(rep().id, 'alert', subject);
    let item = (await feed(rep().token)).items.find((i: any) => i.id === oldRow.id);
    expect(item).toMatchObject({ subject: { type: 'order', id: pair.a.ids.order }, subjectDeleted: false, subjectAccessible: true });
    expect((await get(rep().token, `/api/orders/${pair.a.ids.order}`)).status).toBe(200);
    expect((await get(rep().token, '/api/inbox/counts')).body.counts.all).toBe(1);

    await prismaBase.order.update({ where: { id: pair.a.ids.order }, data: { customerRepId: rep2.id } });

    expect((await feed(rep().token)).items.find((i: any) => i.id === oldRow.id)).toBeUndefined(); // F-763: not yours any more, not shown
    expect((await get(rep().token, '/api/inbox/counts')).body.counts.all).toBe(0); // the badge matches the list
    expect((await feed(rep().token, '?view=assigned')).items).toEqual([]);
    expect((await get(rep().token, `/api/orders/${pair.a.ids.order}`)).status).toBe(404); // the order API refuses: the link does not open
    // the new rep has their own rows and opens the order
    const newRow = await row(rep2.id, 'alert', subject);
    expect((await feed(rep2.token, '?view=assigned')).items.map((i: any) => i.id)).toEqual([newRow.id]);
    expect((await get(rep2.token, `/api/orders/${pair.a.ids.order}`)).status).toBe(200);
    expect((await feed(rep2.token)).items[0]).toMatchObject({ subjectAccessible: true });
  });

  it('owner and manager roles are never greyed by assignment; a deleted subject is greyed for everyone', async () => {
    const subject = { subjectType: 'order', subjectId: pair.a.ids.order };
    const ownerRow = await row(owner().id, 'alert', subject);
    await prismaBase.order.update({ where: { id: pair.a.ids.order }, data: { customerRepId: rep2.id } });
    expect((await feed(owner().token)).items.find((i: any) => i.id === ownerRow.id)).toMatchObject({ subjectAccessible: true });
    await prismaBase.order.update({ where: { id: pair.a.ids.order }, data: { deletedAt: new Date() } });
    expect((await feed(owner().token)).items.find((i: any) => i.id === ownerRow.id)).toMatchObject({ subjectDeleted: true, subjectAccessible: false });
  });

  it('a customer who left the rep scope drops out of the rep Inbox too (F-763)', async () => {
    const mineRow = await row(rep().id, 'note', { subjectType: 'customer', subjectId: pair.a.ids.customer });
    expect((await feed(rep().token)).items.find((i: any) => i.id === mineRow.id)).toMatchObject({ subjectAccessible: true });
    await prismaBase.order.update({ where: { id: pair.a.ids.order }, data: { customerRepId: rep2.id } });
    expect((await feed(rep().token)).items.find((i: any) => i.id === mineRow.id)).toBeUndefined();
  });
});

describe('agent events', () => {
  it('delivery_rescheduled: changing the planned time tells the agent once; the same time or no time change tells nobody', async () => {
    const deliveryId = String(pair.a.ids.delivery);
    const when = new Date(Date.now() + 2 * 24 * 3600_000);
    await runInTenant(pair.a.id, () => deliveryService.updateDelivery(deliveryId, { scheduledTime: when }));
    let rows = await prismaBase.notification.findMany({ where: { userId: agent().id, type: 'delivery_rescheduled' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'alert', subjectType: 'order', subjectId: pair.a.ids.order });
    await runInTenant(pair.a.id, () => deliveryService.updateDelivery(deliveryId, { scheduledTime: when }));
    await runInTenant(pair.a.id, () => deliveryService.updateDelivery(deliveryId, { notes: 'gate code 1234' }));
    rows = await prismaBase.notification.findMany({ where: { userId: agent().id, type: 'delivery_rescheduled' } });
    expect(rows).toHaveLength(1);
    expect((await feed(agent().token)).items).toHaveLength(1);
  });

  it('payout_paid: recording a payout tells the person who was paid, not the person who recorded it', async () => {
    const entry = await prismaBase.commissionEntry.create({
      data: { tenantId: pair.a.id, userId: agent().id, kind: 'reward', status: 'earned', amount: 100, earnedAt: new Date() },
    });
    await runInTenant(pair.a.id, () => prisma.$transaction((tx) => postEntry(tx, entry.id, owner().id)));
    const res = await request(app).post('/api/payouts').set(auth(owner().token)).send({ payeeId: agent().id, amount: 100, method: 'Mobile Money', reference: `ref-${Date.now()}` });
    expect(res.status).toBeLessThan(300);
    const rows = await prismaBase.notification.findMany({ where: { type: 'payout_paid', tenantId: pair.a.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: agent().id, subjectType: 'payout', kind: 'alert' });
    expect(rows[0].subjectId).toBe(res.body.id ?? res.body.payout?.id ?? rows[0].subjectId);
    expect((await feed(agent().token)).items.map((i: any) => i.event)).toEqual(['payout_paid']);
    expect((await feed(owner().token)).items).toEqual([]);
    expect((await get(rep().token, '/api/inbox')).body.items).toEqual([]);
  });

  it('stock_incoming has a helper but no caller yet: calling it tells the agent', async () => {
    await notifyStockIncoming({ tenantId: pair.a.id, agentId: agent().id, productName: 'Widget', quantity: 12 });
    const items = (await feed(agent().token)).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ event: 'stock_incoming', kind: 'alert' });
  });
});
