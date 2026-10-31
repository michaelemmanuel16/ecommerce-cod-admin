/**
 * M6-T05 (COD-56): the staff service. List with tab counts and filters, edit, reset password, deactivate, reactivate, soft and
 * permanent delete, the last-Owner guard, sign-in blocks, workload, and the position role following a UserRole change.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { createTenant, createTwoTenants, deleteTenantRows, TwoTenants } from './helpers/twoTenants';
import { ROLE_NAME_BY_USER_ROLE } from '../../config/defaultRoles';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
const PASSWORD = 'Passw0rd!staff';
let pair: TwoTenants;
let ownerA: string;
let ownerAId: number;
const extraTenants: string[] = [];
let seq = 0;
const uniq = (label: string) => `${label}${SUFFIX}x${seq++}`;

const api = {
  get: (token: string, url: string) => request(app).get(url).set(bearer(token)),
  post: (token: string, url: string, body: object = {}) => request(app).post(url).set(bearer(token)).send(body),
  put: (token: string, url: string, body: object = {}) => request(app).put(url).set(bearer(token)).send(body),
  del: (token: string, url: string, body?: object) => request(app).delete(url).set(bearer(token)).send(body),
};
const login = (email: string, password = PASSWORD) => request(app).post('/api/auth/login').send({ email, password });
const refresh = (refreshToken: string) => request(app).post('/api/auth/refresh').send({ refreshToken });
const tokenOf = (u: { id: number; email: string; role: UserRole }, tenantId: string) =>
  generateAccessToken({ id: u.id, email: u.email, role: u.role, tenantId });

/** A person in tenant A (or `tenantId`) with a real password. `extra` overrides any column. */
async function mkPerson(label: string, role: UserRole = 'sales_rep', extra: Record<string, unknown> = {}, tenantId = pair.a.id) {
  const name = uniq(label);
  const u = await prismaBase.user.create({
    data: { email: `${name}@codadmin.test`, password: await bcrypt.hash(PASSWORD, 4), firstName: name, lastName: 'Staff', role, tenantId, ...extra },
  });
  return { ...u, name, token: tokenOf(u, tenantId) };
}
const rowOf = async (name: string, status?: string) => {
  const res = await api.get(ownerA, `/api/staff?q=${name}${status ? `&status=${status}` : ''}`);
  expect(res.status).toBe(200);
  return res.body.staff as Array<{ id: number; status: string; positions: Array<{ id: number; name: string }>; feeRule: unknown }>;
};
const heldRoles = async (userId: number) =>
  (await prismaBase.roleAssignment.findMany({ where: { holderId: userId, toDate: null }, include: { role: true } })).map((a) => a.role.name);

beforeAll(async () => {
  pair = await createTwoTenants('m6staff');
  ownerA = await superAdminToken(pair.a.id, pair.a.slug);
  ownerAId = (await prismaBase.user.findFirstOrThrow({ where: { tenantId: pair.a.id, role: 'super_admin' } })).id;
}, 90_000);

afterAll(async () => {
  await deleteTenantRows(extraTenants);
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('who may call', () => {
  it('needs a login; a call rep is refused; an admin may read; permanent delete is the Owner alone', async () => {
    expect((await request(app).get('/api/staff')).status).toBe(401);
    expect((await api.get(pair.a.users.salesRep.token, '/api/staff')).status).toBe(403);
    expect((await api.get(pair.a.users.salesRep.token, '/api/staff/workload')).status).toBe(403);
    expect((await api.get(pair.a.users.admin.token, '/api/staff')).status).toBe(200);
    const gone = await mkPerson('gone', 'sales_rep', { isActive: false, deletedAt: new Date() });
    expect((await api.del(pair.a.users.admin.token, `/api/staff/${gone.id}/permanent`, { confirm: gone.email })).status).toBe(403);
  });
});

describe('GET /api/staff', () => {
  it('counts the four tabs, filters by status, role and search, and hides other tenants, the system user and AI agents', async () => {
    const tag = uniq('lst');
    const rep = await mkPerson(`${tag}rep`, 'sales_rep');
    const invited = await mkPerson(`${tag}inv`, 'sales_rep', { isActive: false, invitedAt: new Date(), password: '!' });
    const off = await mkPerson(`${tag}off`, 'accountant', { isActive: false });
    const deleted = await mkPerson(`${tag}del`, 'sales_rep', { isActive: false, deletedAt: new Date() });
    await mkPerson(`${tag}agent`, 'admin', { kind: 'ai_agent', password: '!' });
    await mkPerson(`${tag}other`, 'sales_rep', {}, pair.b.id);

    const all = await api.get(ownerA, `/api/staff?q=${tag}`);
    expect(all.status).toBe(200);
    expect(all.body.counts).toEqual({ active: 1, invited: 1, deactivated: 1, deleted: 1 });
    // no status = everyone but the deleted
    expect(all.body.staff.map((s: { id: number }) => s.id).sort()).toEqual([rep.id, invited.id, off.id].sort());
    expect(all.body.staff.every((s: { status: string }) => s.status !== 'deleted')).toBe(true);

    const del = await api.get(ownerA, `/api/staff?q=${tag}&status=deleted`);
    expect(del.body.staff.map((s: { id: number }) => s.id)).toEqual([deleted.id]);
    expect(del.body.counts.active).toBe(1); // the counts ignore the status filter
    expect((await api.get(ownerA, `/api/staff?q=${tag}&status=invited`)).body.staff.map((s: { id: number }) => s.id)).toEqual([invited.id]);

    const acc = await api.get(ownerA, `/api/staff?q=${tag}&role=accountant`);
    expect(acc.body.staff.map((s: { id: number }) => s.id)).toEqual([off.id]);
    expect(acc.body.counts).toEqual({ active: 0, invited: 0, deactivated: 1, deleted: 0 });
    expect(JSON.stringify(all.body)).not.toContain('password');
    expect((await api.get(ownerA, '/api/staff?status=nope')).status).toBe(400);
  });

  it('filters by the id of a position role the person holds now', async () => {
    const callRep = await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, name: 'Call rep' } });
    const holder = await mkPerson('holder', 'sales_rep');
    await prismaBase.roleAssignment.create({ data: { tenantId: pair.a.id, roleId: callRep.id, holderId: holder.id, fromDate: new Date() } });
    const rows = await api.get(ownerA, `/api/staff?role=${callRep.id}&q=${holder.name}`);
    expect(rows.body.staff.map((s: { id: number }) => s.id)).toEqual([holder.id]);
    expect(rows.body.staff[0].positions).toEqual([{ id: callRep.id, name: 'Call rep' }]);
    expect((await api.get(ownerA, `/api/staff?role=${callRep.id}&q=${(await mkPerson('nohold')).name}`)).body.staff).toEqual([]);
  });
});

describe('PUT /api/staff/:id', () => {
  it('edits name, phone and commission; refuses a duplicate email and unknown fields; the Owner edits an admin, an admin cannot edit the Owner', async () => {
    const p = await mkPerson('edit');
    const res = await api.put(ownerA, `/api/staff/${p.id}`, { firstName: 'Ama', lastName: 'Boateng', phoneNumber: '0244000111', commissionAmount: 7.5 });
    expect(res.status).toBe(200);
    expect(res.body.staff).toMatchObject({ id: p.id, name: 'Ama Boateng', phoneNumber: '0244000111', commissionAmount: '7.5', status: 'active', feeRule: null });

    const dup = await api.put(ownerA, `/api/staff/${p.id}`, { email: pair.a.users.admin.email });
    expect(dup.status).toBe(409);
    expect(dup.body.code ?? dup.body.error?.code).toBeDefined();
    expect((await api.put(ownerA, `/api/staff/${p.id}`, { password: 'sneaky12345' })).status).toBe(400);
    expect((await api.put(ownerA, `/api/staff/${p.id}`, {})).status).toBe(400);
    expect((await api.put(ownerA, '/api/staff/99999999', { firstName: 'X' })).status).toBe(404);

    expect((await api.put(pair.a.users.admin.token, `/api/staff/${ownerAId}`, { firstName: 'Hack', role: 'admin' })).status).toBe(403);
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: ownerAId } })).firstName).toBe('Owner');
  });

  it('a commission change leaves earlier commission entries as they were', async () => {
    const rep = await mkPerson('comm', 'sales_rep', { commissionAmount: 5 });
    const entry = await prismaBase.commissionEntry.create({ data: { tenantId: pair.a.id, userId: rep.id, kind: 'base', amount: '5.0000', status: 'pending' } });
    expect((await api.put(ownerA, `/api/staff/${rep.id}`, { commissionAmount: 12 })).status).toBe(200);
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: rep.id } })).commissionAmount?.toString()).toBe('12');
    expect((await prismaBase.commissionEntry.findUniqueOrThrow({ where: { id: entry.id } })).amount.toString()).toBe('5');
  });

  it('a delivery partner fee is not editable here; the response links to the fee rule', async () => {
    const partner = await mkPerson('partner', 'delivery_agent');
    const bad = await api.put(ownerA, `/api/staff/${partner.id}`, { commissionAmount: 9 });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('FEE_NOT_EDITABLE');
    const ok = await api.put(ownerA, `/api/staff/${partner.id}`, { phoneNumber: '0200000000' });
    expect(ok.status).toBe(200);
    expect(ok.body.staff.feeRule).toEqual({ editable: false, url: `/api/delivery-partners/${partner.id}/fee-rules` });
    expect((await rowOf(partner.name))[0].feeRule).toEqual({ editable: false, url: `/api/delivery-partners/${partner.id}/fee-rules` });
  });

  it('a UserRole change moves the position role too (T03 gap), and keeps a custom role', async () => {
    const created = await api.post(ownerA, '/api/admin/users', {
      email: `${uniq('sync')}@codadmin.test`, password: PASSWORD, firstName: 'Sync', lastName: 'Rep', role: 'sales_rep',
    });
    expect(created.status).toBe(201);
    const id = created.body.user?.id ?? created.body.id;
    expect(await heldRoles(id)).toEqual([ROLE_NAME_BY_USER_ROLE.sales_rep]);
    const custom = await prismaBase.role.create({ data: { tenantId: pair.a.id, name: uniq('Custom'), isSystem: false } });
    await prismaBase.roleAssignment.create({ data: { tenantId: pair.a.id, roleId: custom.id, holderId: id, fromDate: new Date() } });

    // through the staff route and through the old admin route
    expect((await api.put(ownerA, `/api/staff/${id}`, { role: 'accountant' })).status).toBe(200);
    expect((await heldRoles(id)).sort()).toEqual([ROLE_NAME_BY_USER_ROLE.accountant, custom.name].sort());
    expect((await api.put(ownerA, `/api/admin/users/${id}`, { role: 'inventory_manager' })).status).toBe(200);
    expect((await heldRoles(id)).sort()).toEqual([ROLE_NAME_BY_USER_ROLE.inventory_manager, custom.name].sort());
    // the ended assignments stay as history
    expect(await prismaBase.roleAssignment.count({ where: { holderId: id, toDate: { not: null } } })).toBe(2);
    // the same role again changes nothing
    expect((await api.put(ownerA, `/api/staff/${id}`, { role: 'inventory_manager', firstName: 'Same' })).status).toBe(200);
    expect(await prismaBase.roleAssignment.count({ where: { holderId: id } })).toBe(4);
  });
});

describe('reset password', () => {
  it('sets the new password, ends every session; a company, an invited and a deleted person are refused', async () => {
    const p = await mkPerson('reset');
    const first = await login(p.email);
    expect(first.status).toBe(200);
    const res = await api.post(ownerA, `/api/staff/${p.id}/reset-password`, { password: 'BrandNew#1234' });
    expect(res.status).toBe(200);
    expect((await login(p.email)).status).toBe(401);
    expect((await login(p.email, 'BrandNew#1234')).status).toBe(200);
    expect((await refresh(first.body.tokens.refreshToken)).status).toBe(401);

    expect((await api.post(ownerA, `/api/staff/${p.id}/reset-password`, { password: 'short' })).status).toBe(400);
    expect((await api.post(ownerA, `/api/staff/${p.id}/reset-password`, { password: 'longenough1', extra: 1 })).status).toBe(400);
    const company = await mkPerson('co', 'delivery_agent', { kind: 'company' });
    expect((await api.post(ownerA, `/api/staff/${company.id}/reset-password`, { password: 'longenough1' })).status).toBe(400);
    const invited = await mkPerson('inv', 'sales_rep', { isActive: false, invitedAt: new Date(), password: '!' });
    expect((await api.post(ownerA, `/api/staff/${invited.id}/reset-password`, { password: 'longenough1' })).status).toBe(409);
    // an admin cannot reset the Owner
    expect((await api.post(pair.a.users.admin.token, `/api/staff/${ownerAId}/reset-password`, { password: 'longenough1' })).status).toBe(403);
  });
});

describe('deactivate and reactivate', () => {
  it('a deactivated person cannot log in or refresh; their sessions end; reactivating lets them back', async () => {
    const p = await mkPerson('deact');
    const session = await login(p.email);
    expect(session.status).toBe(200);
    expect(await prismaBase.userSession.count({ where: { userId: p.id } })).toBe(1);

    const res = await api.post(ownerA, `/api/staff/${p.id}/deactivate`);
    expect(res.status).toBe(200);
    expect(res.body.staff.status).toBe('deactivated');
    expect(await prismaBase.userSession.count({ where: { userId: p.id } })).toBe(0);
    expect((await login(p.email)).status).toBe(401); // the login lookup skips inactive users: same answer as a wrong password
    expect((await refresh(session.body.tokens.refreshToken)).status).toBe(401);
    expect((await rowOf(p.name, 'deactivated')).length).toBe(1);

    expect((await api.post(ownerA, `/api/staff/${p.id}/deactivate`)).status).toBe(409);
    const back = await api.post(ownerA, `/api/staff/${p.id}/reactivate`);
    expect(back.status).toBe(200);
    expect(back.body.staff.status).toBe('active');
    expect((await login(p.email)).status).toBe(200);
    expect((await api.post(ownerA, `/api/staff/${p.id}/reactivate`)).status).toBe(409);
  });

  it('an accepted invite reads as deactivated after deactivation, not invited', async () => {
    const p = await mkPerson('acc', 'sales_rep', { invitedAt: new Date() });
    expect((await api.post(ownerA, `/api/staff/${p.id}/deactivate`)).body.staff.status).toBe('deactivated');
  });

  it('refuses yourself, an equal rank, and an invited person', async () => {
    expect((await api.post(ownerA, `/api/staff/${ownerAId}/deactivate`)).status).toBe(403);
    const other = await mkPerson('peer', 'admin');
    expect((await api.post(pair.a.users.admin.token, `/api/staff/${other.id}/deactivate`)).status).toBe(403);
    const invited = await mkPerson('inv2', 'sales_rep', { isActive: false, invitedAt: new Date(), password: '!' });
    expect((await api.post(ownerA, `/api/staff/${invited.id}/deactivate`)).status).toBe(409);
    expect((await api.post(ownerA, `/api/staff/${invited.id}/reactivate`)).status).toBe(409);
    // another tenant's person is not found
    const foreign = await mkPerson('foreign', 'sales_rep', {}, pair.b.id);
    expect((await api.post(ownerA, `/api/staff/${foreign.id}/deactivate`)).status).toBe(404);
  });

  it('the last Owner cannot be deactivated, deleted or demoted; with a second Owner the first can go', async () => {
    const tenant = await createTenant('m6staffown');
    extraTenants.push(tenant.id);
    const one = await mkPerson('own1', 'super_admin', {}, tenant.id);
    const two = await mkPerson('own2', 'super_admin', {}, tenant.id);

    const first = await api.post(two.token, `/api/staff/${one.id}/deactivate`);
    expect(first.status).toBe(200);
    // two is now the only active Owner. one's access token is still valid (15 minutes), so it can try.
    for (const res of [
      await api.post(one.token, `/api/staff/${two.id}/deactivate`),
      await api.del(one.token, `/api/staff/${two.id}`),
      await api.put(one.token, `/api/staff/${two.id}`, { role: 'admin' }),
      await api.put(one.token, `/api/admin/users/${two.id}`, { isActive: false }),
      // the old routes had no guard
      await api.del(one.token, `/api/admin/users/${two.id}`),
      await api.del(one.token, `/api/users/${two.id}`),
      await api.del(one.token, `/api/admin/users/${two.id}/permanent`),
    ]) {
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).toContain('last Owner');
    }
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: two.id } })).isActive).toBe(true);
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: two.id } })).role).toBe('super_admin');
    // reactivate the first Owner and the second may be deactivated
    expect((await api.post(two.token, `/api/staff/${one.id}/reactivate`)).status).toBe(200);
    expect((await api.post(one.token, `/api/staff/${two.id}/deactivate`)).status).toBe(200);
  });

  it('two Owners deactivating each other at once: one wins, one gets 409 (the Owner rows are locked)', async () => {
    const tenant = await createTenant('m6staffrace');
    extraTenants.push(tenant.id);
    const one = await mkPerson('race1', 'super_admin', {}, tenant.id);
    const two = await mkPerson('race2', 'super_admin', {}, tenant.id);
    for (const [verb, call] of [
      ['deactivate', (by: { token: string }, of: { id: number }) => api.post(by.token, `/api/staff/${of.id}/deactivate`)],
      ['delete', (by: { token: string }, of: { id: number }) => api.del(by.token, `/api/staff/${of.id}`)],
    ] as const) {
      const results = await Promise.all([call(one, two), call(two, one)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await prismaBase.user.count({ where: { tenantId: tenant.id, role: 'super_admin', isActive: true } })).toBe(1);
      // put both back for the next round
      await prismaBase.user.updateMany({ where: { tenantId: tenant.id }, data: { isActive: true, deletedAt: null } });
      expect(verb).toBeTruthy();
    }
  });

  it('PUT /api/admin/users/:id keeps to its field list: tenant, password, kind, invite and delete fields are dropped', async () => {
    const p = await mkPerson('white', 'sales_rep');
    const before = await prismaBase.user.findUniqueOrThrow({ where: { id: p.id } });
    const res = await api.put(ownerA, `/api/admin/users/${p.id}`, {
      firstName: 'Kept', commissionAmount: '3', tenantId: pair.b.id, password: 'hacked-password', kind: 'company', invitedAt: new Date(),
      deletedAt: new Date(), inviteTokenHash: 'abc', refreshToken: 'abc', totalEarnings: 99999, id: 1,
    });
    expect(res.status).toBe(200);
    const after = await prismaBase.user.findUniqueOrThrow({ where: { id: p.id } });
    expect(after).toMatchObject({ id: p.id, firstName: 'Kept', tenantId: pair.a.id, password: before.password, kind: 'person', invitedAt: null, deletedAt: null, inviteTokenHash: null, refreshToken: null });
    expect(after.commissionAmount?.toString()).toBe('3');
    expect(after.totalEarnings?.toString()).toBe(before.totalEarnings?.toString());
    // a value of the wrong type is refused, not passed on
    expect((await api.put(ownerA, `/api/admin/users/${p.id}`, { role: 'emperor' })).status).toBe(400);
    // an admin cannot deactivate the Owner through the old route either
    expect((await api.put(pair.a.users.admin.token, `/api/admin/users/${ownerAId}`, { isActive: false })).status).toBe(403);
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: ownerAId } })).isActive).toBe(true);
  });
});

describe('delete and permanent delete', () => {
  it('soft delete: Deleted tab, no login, restore with reactivate; a person deleted while invited is restored as invited', async () => {
    const p = await mkPerson('sdel', 'sales_rep', { preferences: { onboardingCompleted: true } });
    const dbRow = () => prismaBase.user.findUniqueOrThrow({ where: { id: p.id } });
    const session = await login(p.email);
    const res = await api.del(ownerA, `/api/staff/${p.id}`);
    expect(res.status).toBe(200);
    expect(res.body.staff.status).toBe('deleted');
    expect(res.body.staff.deletedAt).toBeTruthy();
    expect(await dbRow()).toMatchObject({ isActive: false, preferences: { onboardingCompleted: true } });
    expect((await dbRow()).deletedAt).toBeInstanceOf(Date);
    expect((await rowOf(p.name, 'deleted')).length).toBe(1);
    expect((await rowOf(p.name)).length).toBe(0);
    expect((await login(p.email)).status).toBe(401); // the login lookup skips inactive users: same answer as a wrong password
    expect((await refresh(session.body.tokens.refreshToken)).status).toBe(401);
    expect((await api.del(ownerA, `/api/staff/${p.id}`)).status).toBe(409);
    expect((await api.put(ownerA, `/api/staff/${p.id}`, { firstName: 'X' })).status).toBe(409);

    const back = await api.post(ownerA, `/api/staff/${p.id}/reactivate`);
    expect(back.body.staff.status).toBe('active');
    expect(await dbRow()).toMatchObject({ isActive: true, deletedAt: null, preferences: { onboardingCompleted: true } });

    const inv = await mkPerson('sinv', 'sales_rep', { isActive: false, invitedAt: new Date(), password: '!', inviteTokenHash: uniq('hash') });
    expect((await api.del(ownerA, `/api/staff/${inv.id}`)).body.staff.status).toBe('deleted');
    expect((await prismaBase.user.findUniqueOrThrow({ where: { id: inv.id } })).inviteTokenHash).toBeNull();
    expect((await api.post(ownerA, `/api/staff/${inv.id}/reactivate`)).body.staff.status).toBe('invited');
    expect((await api.del(ownerA, `/api/staff/${ownerAId}`)).status).toBe(403);
  });

  it('permanent delete: only from the Deleted tab, with the typed token; orders keep their history without the person', async () => {
    const rep = await mkPerson('perm', 'sales_rep');
    const order = await prismaBase.order.findFirstOrThrow({ where: { tenantId: pair.a.id } });
    const mine = await prismaBase.order.create({
      data: {
        customerId: order.customerId, customerRepId: rep.id, status: 'confirmed', subtotal: '10', totalAmount: '10', codAmount: '10',
        deliveryAddress: 'x', deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId: pair.a.id,
      },
    });

    expect((await api.del(ownerA, `/api/staff/${rep.id}/permanent`, { confirm: rep.email })).status).toBe(409); // not deleted yet
    await api.del(ownerA, `/api/staff/${rep.id}`);
    expect((await api.del(ownerA, `/api/staff/${rep.id}/permanent`)).status).toBe(400);
    expect((await api.del(ownerA, `/api/staff/${rep.id}/permanent`, { confirm: 'DELETE' })).status).toBe(400); // the old word
    expect((await api.del(ownerA, `/api/staff/${rep.id}/permanent`, { confirm: pair.a.users.admin.email })).status).toBe(400); // someone else's email
    expect(await prismaBase.user.count({ where: { id: rep.id } })).toBe(1);

    const res = await api.del(ownerA, `/api/staff/${rep.id}/permanent`, { confirm: ` ${rep.email.toUpperCase()} ` }); // case does not matter
    expect(res.status).toBe(200);
    expect(await prismaBase.user.count({ where: { id: rep.id } })).toBe(0);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: mine.id } })).customerRepId).toBeNull();
    expect((await api.del(ownerA, `/api/staff/${rep.id}/permanent`, { confirm: rep.email })).status).toBe(404);
    const audit = await prismaBase.auditLog.findFirst({ where: { tenantId: pair.a.id, action: 'staff_permanent_delete', resourceId: String(rep.id) } });
    expect(audit).toBeTruthy();
  });

  it('a person with commission records cannot be erased: 409, and nothing else changes', async () => {
    const rep = await mkPerson('keep', 'sales_rep');
    const order = await prismaBase.order.findFirstOrThrow({ where: { tenantId: pair.a.id } });
    const mine = await prismaBase.order.create({
      data: {
        customerId: order.customerId, customerRepId: rep.id, status: 'delivered', subtotal: '10', totalAmount: '10', codAmount: '10',
        deliveryAddress: 'x', deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId: pair.a.id,
      },
    });
    await prismaBase.commissionEntry.create({ data: { tenantId: pair.a.id, userId: rep.id, kind: 'base', amount: '5', status: 'pending', orderId: mine.id } });
    await api.del(ownerA, `/api/staff/${rep.id}`);
    const res = await api.del(ownerA, `/api/staff/${rep.id}/permanent`, { confirm: rep.email });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain('HAS_RECORDS');
    expect(await prismaBase.user.count({ where: { id: rep.id } })).toBe(1);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: mine.id } })).customerRepId).toBe(rep.id); // rolled back
  });
  it('the old erase route goes through the same erase: a person is gone, orders keep going without them', async () => {
    const rep = await mkPerson('oldperm', 'sales_rep');
    const order = await prismaBase.order.findFirstOrThrow({ where: { tenantId: pair.a.id } });
    const mine = await prismaBase.order.create({
      data: {
        customerId: order.customerId, customerRepId: rep.id, status: 'confirmed', subtotal: '10', totalAmount: '10', codAmount: '10',
        deliveryAddress: 'x', deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId: pair.a.id,
      },
    });
    expect((await api.del(ownerA, `/api/admin/users/${rep.id}/permanent`)).status).toBe(200);
    expect(await prismaBase.user.count({ where: { id: rep.id } })).toBe(0);
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: mine.id } })).customerRepId).toBeNull();
    // another tenant's user is not found, and with records the erase is a 409
    const foreign = await mkPerson('oldforeign', 'sales_rep', {}, pair.b.id);
    expect((await api.del(ownerA, `/api/admin/users/${foreign.id}/permanent`)).status).toBe(404);
    const keep = await mkPerson('oldkeep', 'sales_rep');
    await prismaBase.commissionEntry.create({ data: { tenantId: pair.a.id, userId: keep.id, kind: 'base', amount: '5', status: 'pending' } });
    expect((await api.del(ownerA, `/api/admin/users/${keep.id}/permanent`)).status).toBe(409);
    expect(await prismaBase.user.count({ where: { id: keep.id } })).toBe(1);
  });
});

describe('GET /api/staff/workload', () => {
  it('counts open orders per active person, as call rep and as delivery partner; closed and other tenants do not count', async () => {
    const rep = await mkPerson('wrep', 'sales_rep');
    const agent = await mkPerson('wagent', 'delivery_agent');
    const idle = await mkPerson('widle', 'sales_rep');
    const off = await mkPerson('woff', 'sales_rep', { isActive: false });
    const seed = await prismaBase.order.findFirstOrThrow({ where: { tenantId: pair.a.id } });
    const mk = (status: any, extra: Record<string, unknown>) => prismaBase.order.create({
      data: {
        customerId: seed.customerId, status, subtotal: '10', totalAmount: '10', codAmount: '10',
        deliveryAddress: 'x', deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId: pair.a.id, ...extra,
      },
    });
    await mk('pending_confirmation', { customerRepId: rep.id });
    await mk('confirmed', { customerRepId: rep.id, deliveryAgentId: agent.id });
    await mk('out_for_delivery', { customerRepId: rep.id, deliveryAgentId: agent.id });
    await mk('failed_delivery', { deliveryAgentId: agent.id });
    await mk('delivered', { customerRepId: rep.id, deliveryAgentId: agent.id });
    await mk('cancelled', { customerRepId: rep.id });
    await mk('confirmed', { customerRepId: rep.id, deletedAt: new Date() });
    await mk('confirmed', { customerRepId: off.id });

    const res = await api.get(pair.a.users.admin.token, '/api/staff/workload');
    expect(res.status).toBe(200);
    const by = new Map<number, { openOrders: number; asRep: number; asAgent: number }>(res.body.workload.map((w: { id: number }) => [w.id, w]));
    expect(by.get(rep.id)).toMatchObject({ openOrders: 3, asRep: 3, asAgent: 0 });
    expect(by.get(agent.id)).toMatchObject({ openOrders: 3, asRep: 0, asAgent: 3 });
    expect(by.get(idle.id)).toMatchObject({ openOrders: 0 });
    expect(by.has(off.id)).toBe(false);
    const counts: number[] = res.body.workload.map((w: { openOrders: number }) => w.openOrders);
    expect(counts).toEqual([...counts].sort((a, b) => b - a)); // busiest first
    expect(res.body.workload.every((w: { id: number }) => w.id !== undefined)).toBe(true);
  });
});
