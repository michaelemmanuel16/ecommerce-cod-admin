/**
 * COD-44 review fixes: GET /api/inventory/locations (no figures), GET /api/inventory/transfers/export.csv (roles, filters,
 * formula escape, one audit row), the history list's counts only on request, and one own store per tenant at the database.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { stockUp } from './helpers/stock';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(),
  hasSocketInstance: jest.fn(() => true),
}));

jest.setTimeout(120_000);

let tenantId: string;
let otherTenantId: string;
const U: Record<string, { id: number; token: string }> = {};
let swift: number;
let kofiLoc: number;
let copybook: number;
let pens: number;

const get = (who: string, path: string) => request(app).get(`/api/inventory${path}`).set(bearer(U[who].token));
const post = (who: string, path: string, body: Record<string, unknown> = {}) => request(app).post(`/api/inventory${path}`).set(bearer(U[who].token)).send(body);

beforeAll(async () => {
  tenantId = (await createTenant('Inventory Export')).id;
  otherTenantId = (await createTenant('Inventory Export Other')).id;
  U.owner = await mkUser(tenantId, 'owner', 'super_admin');
  U.admin = await mkUser(tenantId, 'admin', 'admin');
  U.clerk = await mkUser(tenantId, 'clerk', 'accountant');
  U.keeper = await mkUser(tenantId, 'keeper', 'inventory_manager');
  U.manager = await mkUser(tenantId, 'manager', 'manager');
  U.rep = await mkUser(tenantId, 'rep', 'sales_rep');
  U.agent = await mkUser(tenantId, 'agent', 'delivery_agent');
  U.otherOwner = await mkUser(otherTenantId, 'otherowner', 'super_admin');
  const swiftUser = await mkUser(tenantId, 'swift', 'delivery_agent', { kind: 'company' });
  const kofi = await mkUser(tenantId, 'kofi', 'delivery_agent');
  const product = (name: string) =>
    prismaBase.product.create({ data: { sku: `EX-${name}-${Date.now()}`, name, category: 'x', price: 50, cogs: 30, stockQuantity: 0, tenantId } }).then((p) => p.id);
  copybook = await product('Copybook');
  pens = await product('Pens');
  swift = await prismaBase.stockLocation.create({ data: { tenantId, name: 'Swift', type: 'partner_3pl', userId: swiftUser.id } }).then((l) => l.id);
  kofiLoc = await prismaBase.stockLocation.create({ data: { tenantId, name: 'Kofi', type: 'agent', userId: kofi.id } }).then((l) => l.id);
  await prismaBase.stockLocation.create({ data: { tenantId, name: 'Old shop', type: 'own_store', isActive: false } });
  await stockUp(tenantId, copybook, 100, { locationId: swift });
  await stockUp(tenantId, pens, 50, { locationId: swift });
  // A note that starts like a formula
  expect((await post('owner', '/transfers', { type: 'allocation', productId: copybook, quantity: 5, fromLocationId: swift, toLocationId: kofiLoc, note: '=HYPERLINK("x","y")' })).status).toBe(201);
  expect((await post('owner', '/transfers', { type: 'allocation', productId: pens, quantity: 3, fromLocationId: swift, toLocationId: kofiLoc })).status).toBe(201);
  expect((await post('owner', '/adjust', { locationId: swift, productId: pens, newQuantity: 40, reason: 'damaged' })).status).toBe(200);
}, 90_000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('GET /locations', () => {
  it('lists id, name, type and active flag, with no figures; the stock roles read, a rep and an agent do not', async () => {
    const res = await get('keeper', '/locations');
    expect(res.status).toBe(200);
    expect(res.body.locations).toEqual(expect.arrayContaining([
      { id: swift, name: 'Swift', type: 'partner_3pl', isActive: true },
      { id: kofiLoc, name: 'Kofi', type: 'agent', isActive: true },
      expect.objectContaining({ name: 'Old shop', type: 'own_store', isActive: false }),
    ]));
    for (const l of res.body.locations) expect(Object.keys(l).sort()).toEqual(['id', 'isActive', 'name', 'type']);
    for (const who of ['owner', 'manager', 'clerk']) expect([who, (await get(who, '/locations')).status]).toEqual([who, 200]);
    for (const who of ['rep', 'agent']) expect([who, (await get(who, '/locations')).status]).toEqual([who, 403]);
    expect((await request(app).get('/api/inventory/locations')).status).toBe(401);
  });

  it('another tenant sees only its own locations', async () => {
    await prismaBase.stockLocation.create({ data: { tenantId: otherTenantId, name: 'Other shop', type: 'own_store' } });
    const res = await get('otherOwner', '/locations');
    expect(res.body.locations.map((l: any) => l.name)).toEqual(['Other shop']);
  });
});

describe('GET /transfers: counts only on request', () => {
  it('no includeCounts: no total, no tab counts; with it: both, and the total is the sum of the tabs', async () => {
    const plain = await get('owner', '/transfers?limit=2');
    expect(plain.status).toBe(200);
    expect(plain.body.transfers).toHaveLength(2);
    expect(plain.body.typeCounts).toBeUndefined();
    expect(plain.body.pagination).toEqual({ page: 1, limit: 2 });
    const full = await get('owner', '/transfers?limit=2&includeCounts=true');
    const sum = Object.values(full.body.typeCounts as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(full.body.pagination).toMatchObject({ page: 1, limit: 2, total: sum, pages: Math.ceil(sum / 2) });
    const typed = await get('owner', '/transfers?type=allocation&includeCounts=true');
    expect(typed.body.pagination.total).toBe(2);
    expect(typed.body.typeCounts).toMatchObject({ allocation: 2, adjustment: 1 });
  });
});

describe('GET /transfers/export.csv', () => {
  it('owner, admin and finance clerk get a CSV with a header and one row per move', async () => {
    for (const who of ['owner', 'admin', 'clerk']) {
      const res = await get(who, '/transfers/export.csv');
      expect([who, res.status]).toEqual([who, 200]);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('stock-moves.csv');
    }
    const lines = (await get('owner', '/transfers/export.csv')).text.split('\r\n');
    expect(lines[0]).toBe('Date,Type,From,To,Product,SKU,Quantity,Status,Counted,Reason,Order,Started by,Note');
    expect(lines).toHaveLength(1 + 3); // two allocations and one adjustment (stockUp writes no move rows)
  });

  it('applies the list filters', async () => {
    const lines = (await get('owner', `/transfers/export.csv?type=allocation&productId=${pens}`)).text.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Allocation","Swift","Kofi"');
    expect(lines[1]).toContain(',3,"In transit"');
    const adj = (await get('owner', '/transfers/export.csv?type=adjustment')).text.split('\r\n');
    expect(adj[1]).toContain(',-7,');
    expect((await get('owner', '/transfers/export.csv?type=nope')).status).toBe(400);
  });

  it('a cell that starts with = is defused', async () => {
    const text = (await get('owner', `/transfers/export.csv?productId=${copybook}`)).text;
    expect(text).toContain(`"'=HYPERLINK(""x"",""y"")"`);
  });

  it('a stock keeper, a manager, a call rep and an agent get 403; no token is 401', async () => {
    for (const who of ['keeper', 'manager', 'rep', 'agent']) expect([who, (await get(who, '/transfers/export.csv')).status]).toEqual([who, 403]);
    expect((await request(app).get('/api/inventory/transfers/export.csv')).status).toBe(401);
  });

  it('writes one audit row per export, and a second tenant exports only its own moves', async () => {
    const before = await prismaBase.auditLog.count({ where: { tenantId, resource: 'inventory_transfer', action: 'export' } });
    await get('clerk', '/transfers/export.csv?type=allocation');
    const rows = await prismaBase.auditLog.findMany({ where: { tenantId, resource: 'inventory_transfer', action: 'export' }, orderBy: { id: 'desc' } });
    expect(rows).toHaveLength(before + 1);
    expect(rows[0].userId).toBe(U.clerk.id);
    expect(rows[0].metadata).toMatchObject({ rows: 2, filters: { type: 'allocation' } });
    expect((await get('otherOwner', '/transfers/export.csv')).text.split('\r\n')).toHaveLength(1);
  });
});

describe('one own store per tenant, at the database', () => {
  it('two creates at once on a tenant with no own store give one 201 and one 409', async () => {
    const fresh = (await createTenant('Inventory Export Fresh')).id;
    try {
      const owner = await mkUser(fresh, 'freshowner', 'super_admin');
      const send = (name: string) => request(app).post('/api/inventory/locations').set(bearer(owner.token)).send({ name });
      const results = await Promise.all([send('Shop A'), send('Shop B')]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prismaBase.stockLocation.count({ where: { tenantId: fresh, type: 'own_store' } })).toBe(1);
      expect((await send('Shop A')).status).toBe(409);
    } finally {
      await deleteTenantRows([fresh]);
    }
  });

  it('the database itself refuses a second own store, but not a second 3PL', async () => {
    await expect(prismaBase.stockLocation.create({ data: { tenantId, name: 'Second shop', type: 'own_store' } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prismaBase.stockLocation.create({ data: { tenantId, name: 'Another 3PL', type: 'partner_3pl' } })).resolves.toBeTruthy();
  });
});
