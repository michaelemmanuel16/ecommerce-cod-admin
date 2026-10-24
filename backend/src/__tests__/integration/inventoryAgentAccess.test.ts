/**
 * M4-T25 (COD-44): a delivery agent reads /levels and /transfers for their own stock location only (the server forces the
 * filter, another location is 403, no cost or value fields), a second tenant's agent sees nothing of this tenant, the
 * own-store route (one per tenant) and the transfer trail.
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
let esiLoc: number;
let copybook: number;
let pens: number;
let transferId: number;

const get = (who: string, path: string) => request(app).get(`/api/inventory${path}`).set(bearer(U[who].token));
const post = (who: string, path: string, body: Record<string, unknown> = {}) => request(app).post(`/api/inventory${path}`).set(bearer(U[who].token)).send(body);
const COST_WORDS = /cost|cogs|value|price|margin/i;

beforeAll(async () => {
  tenantId = (await createTenant('Agent Access')).id;
  otherTenantId = (await createTenant('Agent Access Other')).id;
  U.owner = await mkUser(tenantId, 'owner', 'super_admin');
  U.keeper = await mkUser(tenantId, 'keeper', 'inventory_manager');
  U.rep = await mkUser(tenantId, 'rep', 'sales_rep');
  U.stranger = await mkUser(tenantId, 'stranger', 'delivery_agent'); // an agent with no stock location
  U.otherAgent = await mkUser(otherTenantId, 'otheragent', 'delivery_agent');
  U.otherOwner = await mkUser(otherTenantId, 'otherowner', 'super_admin');
  const kofi = await mkUser(tenantId, 'kofi', 'delivery_agent');
  const esi = await mkUser(tenantId, 'esi', 'delivery_agent');
  const swiftUser = await mkUser(tenantId, 'swift', 'delivery_agent');
  U.kofi = kofi;
  U.esi = esi;

  const product = (sku: string) =>
    prismaBase.product.create({ data: { sku: `AA-${sku}-${Date.now()}`, name: sku, category: 'x', price: 50, cogs: 30, stockQuantity: 0, tenantId } }).then((p) => p.id);
  copybook = await product('Copybook');
  pens = await product('Pens');
  swift = await prismaBase.stockLocation.create({ data: { tenantId, name: 'Swift', type: 'partner_3pl', userId: swiftUser.id } }).then((l) => l.id);
  kofiLoc = await prismaBase.stockLocation.create({ data: { tenantId, name: 'Kofi', type: 'agent', userId: kofi.id } }).then((l) => l.id);
  esiLoc = await prismaBase.stockLocation.create({ data: { tenantId, name: 'Esi', type: 'agent', userId: esi.id } }).then((l) => l.id);
  await stockUp(tenantId, copybook, 100, { locationId: swift });
  await stockUp(tenantId, pens, 50, { locationId: swift });
  await stockUp(tenantId, pens, 7, { locationId: esiLoc });

  const sent = await post('owner', '/transfers', { type: 'allocation', productId: copybook, quantity: 20, fromLocationId: swift, toLocationId: kofiLoc });
  transferId = sent.body.transfer.id;
  await post('owner', '/transfers', { type: 'allocation', productId: pens, quantity: 5, fromLocationId: swift, toLocationId: esiLoc });
}, 90_000);

afterAll(async () => {
  await deleteTenantRows([tenantId, otherTenantId]);
  await prismaBase.$disconnect();
});

describe('a delivery agent reads their own stock', () => {
  it('/levels with no filter is forced to their location', async () => {
    const res = await get('kofi', '/levels');
    expect(res.status).toBe(200);
    expect(res.body.levels.map((l: any) => [l.locationId, l.productId])).toEqual([[kofiLoc, copybook]]);
    expect(res.body.levels[0]).toMatchObject({ onHand: 0, inTransit: 20 });
  });

  it('their own location id is accepted; another location is 403, also for a location of this tenant that holds stock', async () => {
    expect((await get('kofi', `/levels?locationId=${kofiLoc}`)).status).toBe(200);
    for (const other of [esiLoc, swift]) {
      expect((await get('kofi', `/levels?locationId=${other}`)).status).toBe(403);
      expect((await get('kofi', `/transfers?locationId=${other}`)).status).toBe(403);
    }
  });

  it('/transfers shows only moves into or out of their location; a product filter still works', async () => {
    const res = await get('kofi', '/transfers');
    expect(res.status).toBe(200);
    expect(res.body.transfers.map((t: any) => t.id)).toEqual([transferId]);
    expect((await get('kofi', `/transfers?productId=${pens}`)).body.transfers).toEqual([]);
    expect((await get('esi', '/transfers')).body.transfers.every((t: any) => t.toLocation.name === 'Esi')).toBe(true);
  });

  it('no cost or value fields in either answer', async () => {
    const keys = (v: unknown): string[] => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keys(x)]) : []);
    for (const path of ['/levels', '/transfers']) {
      const res = await get('kofi', path);
      expect([path, keys(res.body).filter((k) => COST_WORDS.test(k))]).toEqual([path, []]);
    }
  });

  it('every other inventory read stays closed to an agent; so do the writes', async () => {
    for (const p of ['/overview', `/product/${copybook}/holders`, '/returns/summary', '/counts', `/transfers/${transferId}/trail`]) {
      expect([p, (await get('kofi', p)).status]).toEqual([p, 403]);
    }
    expect((await post('kofi', '/adjust', { locationId: kofiLoc, productId: copybook, newQuantity: 1, reason: 'damaged' })).status).toBe(403);
    expect((await post('kofi', '/locations', { name: 'My store' })).status).toBe(403);
  });

  it('an agent with no stock location gets 403; a call rep still gets 403', async () => {
    expect((await get('stranger', '/levels')).status).toBe(403);
    expect((await get('stranger', '/transfers')).status).toBe(403);
    expect((await get('rep', '/levels')).status).toBe(403);
  });

  it('the agent confirms stock addressed to them through the existing receive route', async () => {
    const res = await post('kofi', `/transfers/${transferId}/receive`, { quantity: 20 });
    expect(res.status).toBe(200);
    expect(res.body.transfer.status).toBe('received');
    expect((await get('kofi', '/levels')).body.levels[0]).toMatchObject({ onHand: 20, inTransit: 0 });
  });
});

describe('another tenant', () => {
  it("an agent of tenant B gets 403 on tenant A's location and sees nothing of tenant A", async () => {
    // B's agent has no stock location, so both reads are refused
    expect((await get('otherAgent', '/levels')).status).toBe(403);
    expect((await get('otherAgent', `/levels?locationId=${kofiLoc}`)).status).toBe(403);
    // Give B's agent a location: the forced filter shows B's own rows, never A's
    const loc = await prismaBase.stockLocation.create({ data: { tenantId: otherTenantId, name: 'Other agent', type: 'agent', userId: U.otherAgent.id } });
    const res = await get('otherAgent', '/levels');
    expect(res.status).toBe(200);
    expect(res.body.levels).toEqual([]);
    expect((await get('otherAgent', `/levels?locationId=${kofiLoc}`)).status).toBe(403);
    expect((await get('otherAgent', '/transfers')).body.transfers).toEqual([]);
    expect(loc.id).not.toBe(kofiLoc);
  });
});

describe('POST /locations (set up the own store)', () => {
  it('creates the one own store; a second is 409; a missing name is 400; a keeper may, a rep may not; another tenant is separate', async () => {
    expect((await post('owner', '/locations', { name: ' ' })).status).toBe(400);
    expect((await post('rep', '/locations', { name: 'Shop' })).status).toBe(403);
    const created = await post('keeper', '/locations', { name: 'Accra shop', address: 'Osu' });
    expect(created.status).toBe(201);
    expect(created.body.location).toMatchObject({ type: 'own_store', name: 'Accra shop', address: 'Osu', isActive: true });
    expect((await post('owner', '/locations', { name: 'Second shop' })).status).toBe(409);
    expect((await get('owner', '/overview')).body.hasOwnStore).toBe(true);
    expect((await get('otherOwner', '/overview')).body.hasOwnStore).toBe(false);
    expect((await post('otherOwner', '/locations', { name: 'Accra shop' })).status).toBe(201);
    const audit = await prismaBase.auditLog.count({ where: { tenantId, resource: 'stock_location', resourceId: String(created.body.location.id) } });
    expect(audit).toBe(1);
  });

  it('a name already used by another location is 409', async () => {
    // own store exists now, so the name check is reached only in a tenant without one
    const other = await mkUser(otherTenantId, 'otherowner2', 'super_admin');
    await prismaBase.stockLocation.updateMany({ where: { tenantId: otherTenantId, type: 'own_store' }, data: { type: 'partner_3pl', name: 'Taken' } });
    const res = await request(app).post('/api/inventory/locations').set(bearer(other.token)).send({ name: 'Taken' });
    expect(res.status).toBe(409);
  });
});

describe('GET /transfers/:id/trail', () => {
  it('lists the audit rows of a transfer, oldest first, with who did it; 404 for another tenant; 400 for a bad id', async () => {
    const res = await get('owner', `/transfers/${transferId}/trail`);
    expect(res.status).toBe(200);
    expect(res.body.trail.map((r: any) => r.action)).toEqual(['create', 'receive']);
    expect(res.body.trail[0].by).toMatchObject({ id: U.owner.id });
    expect(res.body.trail[1].by).toMatchObject({ id: U.kofi.id });
    expect(res.body.trail[1].details).toMatchObject({ quantitySent: 20, quantityReceived: 20, status: 'received' });
    expect((await get('otherOwner', `/transfers/${transferId}/trail`)).status).toBe(404);
    expect((await get('owner', '/transfers/0/trail')).status).toBe(400);
    expect((await get('owner', '/transfers/999999/trail')).status).toBe(404);
  });
});
