/**
 * M6-T21 (COD-60, F-1163): GET /api/auth/me returns the menu of the roles a person holds. A view-only role gets the view
 * pages, a person with two roles gets both menus, and a seeded role keeps its F-102 menu.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { createTwoTenants, mkUser, TwoTenants } from './helpers/twoTenants';
import { clearAuthCache, disconnectPrisma } from '../../mcp/auth';
import { clearPermissionsCache } from '../../middleware/auth';

jest.setTimeout(90_000);

let pair: TwoTenants;
let owner: string;
let seq = 0;
const api = {
  get: (token: string, url: string) => request(app).get(url).set(bearer(token)),
  post: (token: string, url: string, body: object = {}) => request(app).post(url).set(bearer(token)).send(body),
  put: (token: string, url: string, body: object = {}) => request(app).put(url).set(bearer(token)).send(body),
};
const VIEW_TOOLS = ['view_orders', 'view_customers', 'view_stock', 'view_payouts', 'view_reports', 'view_targets', 'export_data'];

/** A role with these tools, held by a new person whose base role is `base`. */
async function holder(tools: string[], base: 'manager' | 'accountant' = 'manager') {
  const role = (await api.post(owner, '/api/roles', { name: `Viewer-${Date.now()}-${seq++}` })).body.role as { id: number };
  expect((await api.put(owner, `/api/roles/${role.id}/tools`, { tools })).status).toBe(200);
  const person = await mkUser(pair.a.id, 'menu', base);
  expect((await api.post(owner, `/api/roles/${role.id}/assign`, { type: 'existing', holderId: person.id })).status).toBe(201);
  return { ...person, roleId: role.id };
}
const menuOf = async (token: string) => (await api.get(token, '/api/auth/me')).body.menu as string[];

beforeAll(async () => {
  pair = await createTwoTenants('m6menu');
  owner = await superAdminToken(pair.a.id, pair.a.slug);
}, 90_000);

afterAll(async () => {
  clearAuthCache();
  await pair.cleanup();
  await disconnectPrisma();
  await prismaBase.$disconnect();
});

beforeEach(() => { clearAuthCache(); clearPermissionsCache(); });

describe('GET /api/auth/me: menu per role', () => {
  it('a view-only user (read tools only, base role manager) sees the view pages and no write or setup page', async () => {
    const viewer = await holder(VIEW_TOOLS);
    const menu = await menuOf(viewer.token);
    expect(menu).toEqual(['dashboard', 'inbox', 'orders', 'customers', 'products', 'inventory', 'reports', 'targets', 'leaderboard', 'settings']);
  });

  it('a user whose role has no tools still has Dashboard', async () => {
    const empty = await holder([]);
    expect(await menuOf(empty.token)).toEqual(['dashboard', 'inbox', 'settings']);
  });

  it('turning a tool on adds its page at the next read', async () => {
    const viewer = await holder(['view_orders']);
    expect(await menuOf(viewer.token)).not.toContain('customers');
    expect((await api.put(owner, `/api/roles/${viewer.roleId}/tools`, { tools: ['view_orders', 'view_customers'] })).status).toBe(200);
    expect(await menuOf(viewer.token)).toContain('customers');
  });

  it('a person with two roles gets both menus', async () => {
    const viewer = await holder(['view_orders']);
    const finance = await prismaBase.role.findFirstOrThrow({ where: { tenantId: pair.a.id, name: 'Finance clerk' } });
    expect((await api.post(owner, `/api/roles/${finance.id}/assign`, { type: 'existing', holderId: viewer.id })).status).toBe(201);
    expect(await menuOf(viewer.token)).toEqual(expect.arrayContaining(['dashboard', 'orders', 'finance', 'reports']));
  });

  it('the owner and a seeded Admin keep their menus', async () => {
    const ownerMenu = await menuOf(owner);
    expect(ownerMenu).toEqual(expect.arrayContaining(['dashboard', 'checkoutForms', 'staff', 'connections', 'setupNorthStar']));
    const admin = pair.a.users.admin.token;
    expect(await menuOf(admin)).toEqual(expect.arrayContaining(['checkoutForms', 'staff', 'connections']));
  });
});
