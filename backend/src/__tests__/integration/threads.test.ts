/**
 * M9-T19 (COD-80): threads, comments and mentions. Real database, two tenants.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { setRoleGrid } from './helpers/roleGrid';
import { createTwoTenants, mkUser, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
let rep2: { id: number; token: string };
let rep3: { id: number; token: string };
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const rep = () => pair.a.users.salesRep;
const owner = () => pair.a.users.admin;
const get = (token: string, type: string, id: number) => request(app).get(`/api/threads/by-subject/${type}/${id}`).set(auth(token));
const comment = (token: string, type: string, id: number, body: object) => request(app).post(`/api/threads/by-subject/${type}/${id}/comments`).set(auth(token)).send(body);
const rows = (userId: number, type?: string) => prismaBase.notification.findMany({ where: { userId, ...(type ? { type } : {}) } });
let orderId: number;

beforeAll(async () => {
  pair = await createTwoTenants('threads');
  rep2 = await mkUser(pair.a.id, 'rep2', 'sales_rep');
  rep3 = await mkUser(pair.a.id, 'rep3', 'sales_rep');
  orderId = pair.a.ids.order;
}, 30000);

afterAll(async () => {
  await prismaBase.thread.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
  await pair.cleanup();
  await prismaBase.$disconnect();
});

beforeEach(async () => {
  await prismaBase.thread.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
  await prismaBase.notification.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
  await prismaBase.user.updateMany({ where: { id: { in: [rep2.id, rep3.id] } }, data: { isActive: true } });
  await prismaBase.order.update({ where: { id: orderId }, data: { deletedAt: null, customerRepId: rep().id } });
});

describe('GET /api/threads/by-subject/:type/:id', () => {
  it('needs a sign-in, a known subject type and a number', async () => {
    expect((await request(app).get(`/api/threads/by-subject/order/${orderId}`)).status).toBe(401);
    expect((await get(owner().token, 'workflow', 1)).status).toBe(400);
    expect((await get(owner().token, 'order', 0)).status).toBe(400);
  });

  it('returns an empty thread when nobody commented, and creates nothing', async () => {
    const res = await get(rep().token, 'order', orderId);
    expect(res.status).toBe(200);
    expect(res.body.thread).toMatchObject({ id: null, subjectType: 'order', subjectId: orderId, archived: false, unreadCount: 0, comments: [] });
    expect(await prismaBase.thread.count({ where: { tenantId: pair.a.id } })).toBe(0);
  });

  it('one thread per subject, made on the first comment; comments oldest first with author name, replies one level, flags', async () => {
    const c1 = await comment(rep().token, 'order', orderId, { body: 'first' });
    expect(c1.status).toBe(201);
    const c2 = await comment(owner().token, 'order', orderId, { body: 'second' });
    const r1 = await comment(owner().token, 'order', orderId, { body: 'reply to first', parentId: c1.body.comment.id });
    expect(r1.status).toBe(201);
    expect(await prismaBase.thread.count({ where: { tenantId: pair.a.id, subjectType: 'order', subjectId: orderId } })).toBe(1);

    const res = await get(rep().token, 'order', orderId);
    const { comments } = res.body.thread;
    expect(comments.map((c: any) => c.body)).toEqual(['first', 'second']);
    expect(comments[0]).toMatchObject({ authorId: rep().id, edited: false, deleted: false, parentId: null });
    expect(comments[0].authorName).toContain('rep');
    expect(comments[0].replies).toHaveLength(1);
    expect(comments[0].replies[0]).toMatchObject({ body: 'reply to first', parentId: c1.body.comment.id });
    expect(comments[1].replies).toEqual([]);
    // a reply to a reply is refused
    expect((await comment(rep().token, 'order', orderId, { body: 'deep', parentId: r1.body.comment.id })).status).toBe(400);
    // a parent from another thread is refused
    expect((await comment(owner().token, 'customer', pair.a.ids.customer, { body: 'x', parentId: c1.body.comment.id })).status).toBe(400);
  });

  it('my unread count is the comments of others after my last read; opening the thread marks it read', async () => {
    await comment(owner().token, 'order', orderId, { body: 'a' });
    await comment(owner().token, 'order', orderId, { body: 'b' });
    await comment(rep().token, 'order', orderId, { body: 'mine' });
    expect((await get(rep().token, 'order', orderId)).body.thread.unreadCount).toBe(2);
    expect((await get(rep().token, 'order', orderId)).body.thread.unreadCount).toBe(0);
    expect(await prismaBase.threadRead.count({ where: { userId: rep().id } })).toBe(1); // upsert, not a new row each time
    await new Promise((r) => setTimeout(r, 20));
    await comment(owner().token, 'order', orderId, { body: 'c' });
    expect((await get(rep().token, 'order', orderId)).body.thread.unreadCount).toBe(1);
  });

  it('two tenants: the other tenant gets 404 and never sees the thread', async () => {
    await comment(rep().token, 'order', orderId, { body: 'tenant A secret' });
    expect((await get(pair.b.users.admin.token, 'order', orderId)).status).toBe(404);
    expect((await comment(pair.b.users.admin.token, 'order', orderId, { body: 'x' })).status).toBe(404);
    const own = await get(pair.b.users.admin.token, 'order', pair.b.ids.order);
    expect(JSON.stringify(own.body)).not.toContain('tenant A secret');
    await comment(pair.b.users.admin.token, 'order', pair.b.ids.order, { body: 'tenant B note' });
    expect(JSON.stringify((await get(owner().token, 'order', orderId)).body)).not.toContain('tenant B note');
  });
});

describe('who can open a thread', () => {
  it('a rep opens threads only for orders and customers they can see today', async () => {
    await comment(owner().token, 'order', orderId, { body: 'owner note' });
    expect((await get(rep().token, 'order', orderId)).status).toBe(200);
    expect((await get(rep2.token, 'order', orderId)).status).toBe(403);
    expect((await comment(rep2.token, 'order', orderId, { body: 'sneak' })).status).toBe(403);
    expect((await get(rep().token, 'customer', pair.a.ids.customer)).status).toBe(200);
    expect((await get(rep2.token, 'customer', pair.a.ids.customer)).status).toBe(403);
    // the order moves to rep2: rep loses it and rep2 gains it
    await prismaBase.order.update({ where: { id: orderId }, data: { customerRepId: rep2.id } });
    expect((await get(rep().token, 'order', orderId)).status).toBe(403);
    expect((await get(rep2.token, 'order', orderId)).status).toBe(200);
  });

  it('a delivery agent sees only their own delivery orders; the owner sees all four subject kinds', async () => {
    expect((await get(pair.a.users.deliveryAgent.token, 'order', orderId)).status).toBe(200);
    await prismaBase.order.update({ where: { id: orderId }, data: { deliveryAgentId: null } });
    expect((await get(pair.a.users.deliveryAgent.token, 'order', orderId)).status).toBe(403);
    await prismaBase.order.update({ where: { id: orderId }, data: { deliveryAgentId: pair.a.users.deliveryAgent.id } });
    for (const [type, id] of [['order', orderId], ['customer', pair.a.ids.customer], ['payout', pair.a.ids.payout], ['product', pair.a.ids.product]] as const) {
      expect((await get(owner().token, type, id)).status).toBe(200);
    }
  });
});

describe('role permission', () => {
  it('a role without orders:view or customers:view cannot open, comment on, or be mentioned on those threads', async () => {
    await comment(owner().token, 'order', orderId, { body: 'owner note' });
    await setRoleGrid(pair.a.id, 'sales_rep', { orders: [], customers: [] });
    try {
      expect((await get(rep().token, 'order', orderId)).status).toBe(403);
      expect((await get(rep().token, 'customer', pair.a.ids.customer)).status).toBe(403);
      expect((await comment(rep().token, 'order', orderId, { body: 'x' })).status).toBe(403);
      const m = await comment(owner().token, 'order', orderId, { body: 'hi', mentionIds: [rep().id] });
      expect(m.status).toBe(400);
      expect(m.body.error ?? m.body.message).toContain('cannot see this order');
    } finally {
      await setRoleGrid(pair.a.id, 'sales_rep');
    }
    expect((await get(rep().token, 'order', orderId)).status).toBe(200);
  });
});

describe('POST comments', () => {
  it('text over 4000 characters is 400; exactly 4000 is fine; an empty comment is 400', async () => {
    expect((await comment(rep().token, 'order', orderId, { body: 'a'.repeat(4001) })).status).toBe(400);
    expect((await comment(rep().token, 'order', orderId, { body: '   ' })).status).toBe(400);
    expect((await comment(rep().token, 'order', orderId, { body: 'a'.repeat(4000) })).status).toBe(201);
  });

  it('plain text: <script> comes back as the same text, as JSON and never as HTML', async () => {
    const text = '<script>alert(1)</script> & "quotes" <b>bold</b>';
    const posted = await comment(rep().token, 'order', orderId, { body: text });
    expect(posted.body.comment.body).toBe(text);
    const read = await get(rep().token, 'order', orderId);
    expect(read.body.thread.comments[0].body).toBe(text);
    for (const res of [posted, read]) {
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['content-type']).not.toMatch(/html/);
    }
    const stored = await prismaBase.comment.findFirstOrThrow({ where: { tenantId: pair.a.id } });
    expect(stored.body).toBe(text);
  });

  it('a mention notifies the person ONCE (duplicates in the list, edit, and a second read add nothing); the author is never notified', async () => {
    const res = await comment(rep().token, 'order', orderId, { body: 'please check @owner', mentionIds: [owner().id, owner().id, rep().id] });
    expect(res.status).toBe(201);
    const mine = await rows(owner().id, 'mention');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: 'mention', subjectType: 'order', subjectId: orderId, actorId: rep().id, isRead: false });
    expect(await rows(rep().id)).toHaveLength(0);
    // editing does not notify again
    const edit = await request(app).patch(`/api/comments/${res.body.comment.id}`).set(auth(rep().token)).send({ body: 'please check @owner (edited)' });
    expect(edit.status).toBe(200);
    expect(await rows(owner().id, 'mention')).toHaveLength(1);
    // the mention shows in the Mentions view of the feed
    const feed = await request(app).get('/api/inbox?view=mentions').set(auth(owner().token));
    expect(feed.body.items).toHaveLength(1);
  });

  it('only active people of my tenant can be mentioned: inactive, other tenant and unknown ids are 400, nothing is saved', async () => {
    await prismaBase.user.update({ where: { id: rep2.id }, data: { isActive: false } });
    for (const ids of [[rep2.id], [pair.b.users.admin.id], [999999999], [owner().id, rep2.id]]) {
      expect((await comment(rep().token, 'order', orderId, { body: 'hi', mentionIds: ids })).status).toBe(400);
    }
    expect(await prismaBase.comment.count({ where: { tenantId: pair.a.id } })).toBe(0);
    expect(await rows(owner().id)).toHaveLength(0);
  });

  it('other people who commented get a team_note; not the author, not people already mentioned', async () => {
    await comment(rep().token, 'order', orderId, { body: 'one' });      // rep
    await comment(owner().token, 'order', orderId, { body: 'two' }); // owner
    await comment(pair.a.users.deliveryAgent.token, 'order', orderId, { body: 'three' }); // agent
    await prismaBase.notification.deleteMany({ where: { tenantId: pair.a.id } });

    await comment(owner().token, 'order', orderId, { body: 'four', mentionIds: [pair.a.users.deliveryAgent.id] });
    expect((await rows(rep().id, 'team_note'))).toHaveLength(1);                       // commented before: team_note
    expect((await rows(pair.a.users.deliveryAgent.id, 'mention'))).toHaveLength(1);    // mentioned: mention
    expect((await rows(pair.a.users.deliveryAgent.id, 'team_note'))).toHaveLength(0);  // not both
    expect((await rows(owner().id))).toHaveLength(0);                                  // the author
    expect(await rows(rep3.id)).toHaveLength(0);                                       // never commented
    const note = (await rows(rep().id, 'team_note'))[0];
    expect(note).toMatchObject({ kind: 'note', subjectType: 'order', subjectId: orderId });
  });

  it('a deactivated earlier commenter gets nothing, and the owner does not receive the copy', async () => {
    await comment(rep().token, 'order', orderId, { body: 'one' });
    await prismaBase.user.update({ where: { id: rep().id }, data: { isActive: false } });
    await comment(owner().token, 'order', orderId, { body: 'two' });
    await prismaBase.user.update({ where: { id: rep().id }, data: { isActive: true } });
    expect(await prismaBase.notification.count({ where: { tenantId: pair.a.id } })).toBe(0);
  });
});

describe('comment text stays with people who can see the subject', () => {
  it('mentioning a rep who cannot see the order is 400 and names them; an owner or the assigned rep can be mentioned', async () => {
    const res = await comment(owner().token, 'order', orderId, { body: 'hi', mentionIds: [rep2.id] });
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message).toContain('cannot see this order');
    expect(await prismaBase.comment.count({ where: { tenantId: pair.a.id } })).toBe(0);
    expect(await rows(rep2.id)).toHaveLength(0);
    expect((await comment(owner().token, 'order', orderId, { body: 'ok', mentionIds: [rep().id] })).status).toBe(201);
  });

  it('an earlier commenter who lost access gets no team_note; one who still has access does', async () => {
    await comment(rep().token, 'order', orderId, { body: 'mine' });
    await comment(pair.a.users.deliveryAgent.token, 'order', orderId, { body: 'agent' });
    await prismaBase.order.update({ where: { id: orderId }, data: { customerRepId: rep2.id } }); // rep loses the order
    await prismaBase.notification.deleteMany({ where: { tenantId: pair.a.id } });
    await comment(owner().token, 'order', orderId, { body: 'secret update' });
    expect(await rows(rep().id)).toHaveLength(0);
    expect(await rows(pair.a.users.deliveryAgent.id, 'team_note')).toHaveLength(1);
  });

  it('an author whose order moved to another rep gets 404 on edit and on delete; the owner can still delete', async () => {
    const c = (await comment(rep().token, 'order', orderId, { body: 'before' })).body.comment;
    await prismaBase.order.update({ where: { id: orderId }, data: { customerRepId: rep2.id } });
    expect((await request(app).patch(`/api/comments/${c.id}`).set(auth(rep().token)).send({ body: 'after' })).status).toBe(404);
    expect((await request(app).delete(`/api/comments/${c.id}`).set(auth(rep().token))).status).toBe(404);
    expect((await prismaBase.comment.findUniqueOrThrow({ where: { id: c.id } })).body).toBe('before');
    expect((await request(app).delete(`/api/comments/${c.id}`).set(auth(owner().token))).status).toBe(200);
  });
});

describe('edit and delete a comment', () => {
  it('only the author edits; the edit sets editedAt and the flag', async () => {
    const c = (await comment(rep().token, 'order', orderId, { body: 'draft' })).body.comment;
    const patch = (token: string, body: object) => request(app).patch(`/api/comments/${c.id}`).set(auth(token)).send(body);
    expect((await patch(owner().token, { body: 'hijack' })).status).toBe(403);
    expect((await patch(pair.b.users.admin.token, { body: 'x' })).status).toBe(404);
    expect((await patch(rep().token, { body: 'a'.repeat(4001) })).status).toBe(400);
    const ok = await patch(rep().token, { body: 'final' });
    expect(ok.body.comment).toMatchObject({ body: 'final', edited: true });
    expect((await prismaBase.comment.findUniqueOrThrow({ where: { id: c.id } })).editedAt).not.toBeNull();
    expect((await get(rep().token, 'order', orderId)).body.thread.comments[0]).toMatchObject({ body: 'final', edited: true });
  });

  it('the author, an admin and the owner delete (soft); another rep cannot; the text is hidden as "Comment deleted"', async () => {
    const make = async () => (await comment(rep().token, 'order', orderId, { body: 'secret words' })).body.comment.id as number;
    const del = (token: string, id: number) => request(app).delete(`/api/comments/${id}`).set(auth(token));
    const a = await make();
    expect((await del(rep2.token, a)).status).toBe(403);
    expect((await del(pair.b.users.admin.token, a)).status).toBe(404);
    const done = await del(rep().token, a);
    expect(done.status).toBe(200);
    expect(done.body.comment).toMatchObject({ body: 'Comment deleted', deleted: true });
    const b = await make();
    expect((await del(owner().token, b)).status).toBe(200);
    const read = await get(rep().token, 'order', orderId);
    expect(read.body.thread.comments.map((c: any) => c.body)).toEqual(['Comment deleted', 'Comment deleted']);
    expect(JSON.stringify(read.body)).not.toContain('secret words');
    expect((await prismaBase.comment.findUniqueOrThrow({ where: { id: a } })).deletedAt).not.toBeNull(); // the row stays
    expect((await request(app).patch(`/api/comments/${a}`).set(auth(rep().token)).send({ body: 'revive' })).status).toBe(409);
  });
});

describe('archived threads', () => {
  it('deleting the order through the order API archives its thread: it can still be read, but not commented on (409)', async () => {
    await prismaBase.order.update({ where: { id: orderId }, data: { status: 'cancelled' } });
    await comment(owner().token, 'order', orderId, { body: 'before delete' });
    const del = await request(app).delete(`/api/orders/${orderId}`).set(auth(owner().token));
    expect(del.status).toBe(200);
    expect((await prismaBase.thread.findFirstOrThrow({ where: { tenantId: pair.a.id, subjectType: 'order', subjectId: orderId } })).archivedAt).not.toBeNull();
    const read = await get(owner().token, 'order', orderId);
    expect(read.status).toBe(200);
    expect(read.body.thread).toMatchObject({ archived: true });
    expect(read.body.thread.comments[0].body).toBe('before delete');
    expect((await comment(owner().token, 'order', orderId, { body: 'after' })).status).toBe(409);
    expect((await request(app).patch(`/api/comments/${read.body.thread.comments[0].id}`).set(auth(owner().token)).send({ body: 'edit' })).status).toBe(409);
    // a deleted order with no thread has nothing to read
    await prismaBase.thread.deleteMany({ where: { tenantId: pair.a.id } });
    expect((await get(owner().token, 'order', orderId)).status).toBe(404);
    await prismaBase.order.update({ where: { id: orderId }, data: { status: 'out_for_delivery' } });
  });

  it('archiveThreadsFor closes the threads of a deleted customer and product', async () => {
    const customer = await prismaBase.customer.create({ data: { firstName: 'Temp', lastName: 'Cust', phoneNumber: `+2332${Date.now() % 100000000}`, address: 'x', state: 'Greater Accra', area: 'Accra', tenantId: pair.a.id } });
    const product = await prismaBase.product.create({ data: { name: 'Temp prod', sku: `TMP-${Date.now()}`, category: 'test', price: 5, stockQuantity: 1, tenantId: pair.a.id } });
    await comment(owner().token, 'customer', customer.id, { body: 'cust note' });
    await comment(owner().token, 'product', product.id, { body: 'prod note' });
    expect((await request(app).delete(`/api/customers/${customer.id}`).set(auth(owner().token))).status).toBe(200);
    expect((await request(app).delete(`/api/products/${product.id}`).set(auth(owner().token))).status).toBe(200);
    const archived = await prismaBase.thread.findMany({ where: { tenantId: pair.a.id, subjectType: { in: ['customer', 'product'] } } });
    expect(archived).toHaveLength(2);
    expect(archived.every((t) => t.archivedAt !== null)).toBe(true);
    expect((await comment(owner().token, 'customer', customer.id, { body: 'late' })).status).toBe(409);
    await prismaBase.thread.deleteMany({ where: { tenantId: pair.a.id } });
    await prismaBase.customer.deleteMany({ where: { id: customer.id } });
    await prismaBase.product.deleteMany({ where: { id: product.id } });
  });
});
