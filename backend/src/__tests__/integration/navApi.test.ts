/**
 * M3-T07 (COD-22): the navigation API. GET /api/nav/counts, GET /api/auth/me (permissions, homeRoute, menu, roles),
 * GET /api/orders/statuses, and the default permission matrix changes (marketing, sales_rep loses customers:delete).
 * Counts are checked on the numbers fixture (64 orders in pending_confirmation) and on two tenants.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { adminService } from '../../services/adminService';
import { seedFixture, deleteFixtureRows } from '../fixtures/numbersFixture';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { menuKeys } from '../../services/navService';

jest.setTimeout(180_000);

const SUFFIX = Date.now();
let fixtureTenantId: string;
let pair: TwoTenants;
const tokens: Record<string, string> = {};
let ownerId: number;

const mkUser = async (label: string, role: any) => {
  const u = await prismaBase.user.create({
    data: { email: `nav-${label}-${SUFFIX}@codadmin.test`, password: 'x', firstName: label, lastName: 'Nav', role, tenantId: fixtureTenantId },
  });
  tokens[label] = generateAccessToken({ id: u.id, email: u.email, role, tenantId: fixtureTenantId });
  return u;
};

beforeAll(async () => {
  fixtureTenantId = (await seedFixture(prismaBase)).tenantId;
  ownerId = (await mkUser('owner', 'super_admin')).id;
  await mkUser('finance', 'accountant');
  await mkUser('stock', 'inventory_manager');
  await mkUser('manager', 'manager');
  await mkUser('admin', 'admin');
  pair = await createTwoTenants('navapi');
}, 180_000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.notification.deleteMany({ where: { tenantId: fixtureTenantId } });
  await prismaBase.finding.deleteMany({ where: { tenantId: fixtureTenantId } });
  await prismaBase.user.deleteMany({ where: { tenantId: fixtureTenantId, email: { startsWith: 'nav-' } } });
  await deleteFixtureRows(prismaBase, fixtureTenantId);
  await prismaBase.$disconnect();
});

describe('GET /api/auth/me', () => {
  it('finance clerk lands on /finance, owner on /, stock keeper on /inventory', async () => {
    const get = (label: string) => request(app).get('/api/auth/me').set(bearer(tokens[label]));
    expect((await get('finance')).body.homeRoute).toBe('/finance');
    expect((await get('owner')).body.homeRoute).toBe('/');
    expect((await get('manager')).body.homeRoute).toBe('/');
    expect((await get('stock')).body.homeRoute).toBe('/inventory');
  });

  it('keeps the old fields and adds permissions, menu and roles', async () => {
    const res = await request(app).get('/api/auth/me').set(bearer(tokens.finance));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'accountant', isActive: true });
    expect(res.body.user.email).toContain('nav-finance');
    expect(res.body.permissions.financial).toEqual(expect.arrayContaining(['view']));
    expect(res.body.menu).toEqual(expect.arrayContaining(['inbox', 'orders', 'finance', 'reports', 'settings']));
    // no RoleAssignment: the base role name, no id
    expect(res.body.roles).toEqual([{ id: null, name: 'Finance clerk' }]);
  });

  it('roles come from RoleAssignment (two-tenant: only the tenant\'s own roles)', async () => {
    const a = await request(app).get('/api/auth/me').set(bearer(pair.a.users.admin.token));
    expect(a.body.roles).toEqual([{ id: pair.a.ids.role, name: 'Owner' }]);
    const b = await request(app).get('/api/auth/me').set(bearer(pair.b.users.admin.token));
    expect(b.body.roles).toEqual([{ id: pair.b.ids.role, name: 'Owner' }]);
    expect(pair.a.ids.role).not.toBe(pair.b.ids.role);
  });

  it('an assignment that ended is ignored', async () => {
    const rep = pair.a.users.salesRep;
    const role = await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, name: 'Call rep' } });
    await prismaBase.roleAssignment.create({
      data: { tenantId: pair.a.id, roleId: role.id, holderId: rep.id, fromDate: new Date('2026-01-01'), toDate: new Date('2026-02-01') },
    });
    const res = await request(app).get('/api/auth/me').set(bearer(rep.token));
    expect(res.body.roles).toEqual([{ id: null, name: 'Call rep' }]);
  });

  it('401 with no token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
  });
});

describe('default permission matrix', () => {
  it('has marketing:view for owner, admin, manager only; sales_rep cannot delete customers; force_status is super_admin only', async () => {
    const defaults = adminService.getDefaultPermissions() as Record<string, Record<string, string[]>>;
    for (const role of ['super_admin', 'admin', 'manager']) expect(defaults[role].marketing).toEqual(['view']);
    for (const role of ['sales_rep', 'inventory_manager', 'delivery_agent', 'accountant']) expect(defaults[role].marketing).toEqual([]);
    expect(defaults.sales_rep.customers).not.toContain('delete');
    expect(defaults.manager.customers).toContain('delete');
    expect(defaults.super_admin.orders).toContain('force_status');
    expect(defaults.admin.orders).not.toContain('force_status');
  });

  it('the settings default (adminService) holds the finance resources the auth middleware grants', async () => {
    const defaults = adminService.getDefaultPermissions() as Record<string, Record<string, string[]>>;
    expect(defaults.super_admin.payouts).toEqual(['view', 'create']);
    expect(defaults.super_admin.journal).toEqual(['post', 'void']);
    expect(defaults.accountant.expenses).toEqual(['view_all', 'edit', 'delete']);
  });

  it('effective permissions of a sales rep (auth middleware copy) have no customers:delete', async () => {
    const res = await request(app).get('/api/auth/me').set(bearer(pair.a.users.salesRep.token));
    expect(res.body.permissions.customers).not.toContain('delete');
    expect(res.body.permissions.marketing).toEqual([]);
    expect((await request(app).delete(`/api/customers/${pair.a.ids.customer}`).set(bearer(pair.a.users.salesRep.token))).status).toBe(403);
  });
});

describe('menu per role (F-102 table)', () => {
  const perms = async (label: string) =>
    (await request(app).get('/api/auth/me').set(bearer(tokens[label]))).body.permissions;
  const ALL = ['dashboard', 'inbox', 'orders', 'customers', 'checkoutForms', 'messages', 'products', 'inventory', 'deliveries',
    'finance', 'marketing', 'reports', 'targets', 'leaderboard', 'staff', 'workflows', 'connections', 'settings', 'setupNorthStar'];
  const without = (...keys: string[]) => ALL.filter((k) => !keys.includes(k));

  it('owner sees everything', async () => {
    expect(menuKeys('super_admin', await perms('owner'))).toEqual(ALL);
  });
  it('admin sees everything but Set up North Star', async () => {
    expect(menuKeys('admin', await perms('admin'))).toEqual(without('setupNorthStar'));
  });
  it('manager: Checkout forms, but no Connections or North Star; Staff read only', async () => {
    expect(menuKeys('manager', await perms('manager'))).toEqual(without('connections', 'setupNorthStar'));
  });
  it('finance clerk', async () => {
    expect(menuKeys('accountant', await perms('finance'))).toEqual(
      ['inbox', 'orders', 'customers', 'products', 'finance', 'reports', 'leaderboard', 'settings']);
  });
  it('stock keeper', async () => {
    expect(menuKeys('inventory_manager', await perms('stock'))).toEqual(
      ['inbox', 'orders', 'customers', 'products', 'inventory', 'leaderboard', 'settings']);
  });
  it('follows a custom matrix', () => {
    expect(menuKeys('accountant', { financial: [], marketing: ['view'], orders: [] })).toEqual(['inbox', 'marketing', 'leaderboard', 'settings']);
  });
});

describe('GET /api/nav/counts', () => {
  it('fixture: Orders pill is 64 (pending_confirmation)', async () => {
    const res = await request(app).get('/api/nav/counts').set(bearer(tokens.owner));
    expect(res.status).toBe(200);
    expect(res.body.ordersPending).toBe(64);
    expect(Object.keys(res.body).sort()).toEqual(['financeOpen', 'inbox', 'ordersPending']);
  });

  it('inbox counts the caller\'s unread notifications; financeOpen counts open Findings', async () => {
    const mk = (isRead: boolean, userId = ownerId) =>
      prismaBase.notification.create({ data: { userId, type: 'info', title: 't', message: 'm', isRead, tenantId: fixtureTenantId } });
    await mk(false); await mk(false); await mk(true);
    const finding = (status: 'open' | 'explained' | 'closed') =>
      prismaBase.finding.create({ data: { type: 'cash_gap', status, subjectType: 'day', subjectId: `d-${status}-${Math.random()}`, tenantId: fixtureTenantId } });
    await finding('open'); await finding('open'); await finding('closed'); await finding('explained');
    const res = await request(app).get('/api/nav/counts').set(bearer(tokens.owner));
    expect(res.body).toMatchObject({ inbox: 2, ordersPending: 64, financeOpen: 2 });
    // another user has their own inbox
    expect((await request(app).get('/api/nav/counts').set(bearer(tokens.manager))).body.inbox).toBe(0);
  });

  it('counts only what the role may see', async () => {
    const stock = await request(app).get('/api/nav/counts').set(bearer(tokens.stock));
    expect(stock.body).toMatchObject({ ordersPending: 64, financeOpen: 0 }); // inventory_manager has orders:view, no financial:view
    const finance = await request(app).get('/api/nav/counts').set(bearer(tokens.finance));
    expect(finance.body).toMatchObject({ ordersPending: 64, financeOpen: 2 });
  });

  it('a call rep counts only own pending orders', async () => {
    const rep = await prismaBase.user.findFirstOrThrow({ where: { tenantId: fixtureTenantId, email: { startsWith: 'rep-adwoa' } } });
    const token = generateAccessToken({ id: rep.id, email: rep.email, role: 'sales_rep', tenantId: fixtureTenantId });
    const own = await prismaBase.order.count({ where: { tenantId: fixtureTenantId, customerRepId: rep.id, status: 'pending_confirmation' } });
    expect(own).toBeGreaterThan(0);
    expect(own).toBeLessThan(64);
    expect((await request(app).get('/api/nav/counts').set(bearer(token))).body.ordersPending).toBe(own);
  });

  it('two tenants: each sees only its own rows', async () => {
    const mkPending = (tenantId: string, customerId: number) =>
      prismaBase.order.create({
        data: { customerId, status: 'pending_confirmation', subtotal: 10, totalAmount: 10, codAmount: 10, tenantId,
          deliveryAddress: '1 St', deliveryState: 'Greater Accra', deliveryArea: 'Accra' } as any,
      });
    await mkPending(pair.b.id, pair.b.ids.customer);
    await mkPending(pair.b.id, pair.b.ids.customer);
    const a = await request(app).get('/api/nav/counts').set(bearer(pair.a.users.admin.token));
    const b = await request(app).get('/api/nav/counts').set(bearer(pair.b.users.admin.token));
    expect(a.body).toEqual({ inbox: 1, ordersPending: 0, financeOpen: 1 });
    expect(b.body).toEqual({ inbox: 1, ordersPending: 2, financeOpen: 1 });
  });

  it('401 with no token', async () => {
    expect((await request(app).get('/api/nav/counts')).status).toBe(401);
  });
});

describe('GET /api/orders/statuses', () => {
  it('returns the 12 statuses of the state machine', async () => {
    const res = await request(app).get('/api/orders/statuses').set(bearer(tokens.owner));
    expect(res.status).toBe(200);
    expect(res.body.statuses).toHaveLength(12);
    expect(res.body.statuses).toEqual(expect.arrayContaining(['pending_confirmation', 'payment_pending', 'confirmed', 'preparing',
      'ready_for_pickup', 'out_for_delivery', 'delivered', 'digital_delivered', 'cancelled', 'returned', 'failed_delivery', 'payment_failed']));
  });

  it('needs only orders:view: a call rep reads it, a request without a token does not', async () => {
    expect((await request(app).get('/api/orders/statuses').set(bearer(pair.a.users.salesRep.token))).status).toBe(200);
    expect((await request(app).get('/api/orders/statuses')).status).toBe(401);
  });
});
