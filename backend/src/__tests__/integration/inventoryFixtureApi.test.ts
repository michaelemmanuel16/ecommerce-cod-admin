/**
 * M4-T15 / T16 / T17 (COD-41): the inventory and products routes on the NUMBERS.md fixture, through HTTP. Seeds the
 * fixture once. Read-only on the fixture rows except the Findings the routes open.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { bearer } from './helpers/superAdminToken';
import { toolData } from './helpers/callTool';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';

jest.setTimeout(240_000);

let tenantId: string;
let token: string;
let ownerToken: string;
const sku: Record<string, number> = {};
const loc: Record<string, number> = {};

const get = (path: string) => request(app).get(path).set(bearer(token));

beforeAll(async () => {
  tenantId = (await seedFixture(prismaBase)).tenantId;
  const admin = await prismaBase.user.findFirstOrThrow({ where: { tenantId, role: 'admin' } });
  token = generateAccessToken({ id: admin.id, email: admin.email, role: 'admin', tenantId });
  // The fixture admin has no stored update_stock permission; counts are written by an owner
  const owner = await prismaBase.user.create({ data: { email: `inv-owner-${Date.now()}@codadmin.test`, password: 'x', firstName: 'Owner', lastName: 'T', role: 'super_admin', tenantId } });
  ownerToken = generateAccessToken({ id: owner.id, email: owner.email, role: 'super_admin', tenantId });
  await prismaBase.finding.deleteMany({ where: { tenantId, subjectType: { in: ['return_missing', 'stock_count_line'] } } });
  for (const p of await prismaBase.product.findMany({ where: { tenantId } })) sku[p.sku] = p.id;
  for (const l of await prismaBase.stockLocation.findMany({ where: { tenantId } })) loc[l.name] = l.id;
});

afterAll(async () => {
  // Rows the routes wrote that deleteFixtureRows does not know
  await prismaBase.stockCountLine.deleteMany({ where: { tenantId } });
  await prismaBase.finding.deleteMany({ where: { tenantId, subjectType: { in: ['return_missing', 'stock_count_line'] } } });
  await prismaBase.auditLog.deleteMany({ where: { tenantId } });
  await deleteFixtureRows(prismaBase, tenantId);
  await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  await prismaBase.$disconnect();
});

describe('inventory on the fixture (T15)', () => {
  it('overview: Logiswift on hand 442, reserved 116, copybook count 188 against 200 (difference 12, "12 units off")', async () => {
    const { body } = await get('/api/inventory/overview');
    const card = (name: string) => body.locations.find((l: any) => l.name === name);
    expect(card('Logiswift')).toMatchObject({ onHand: 442, reserved: 116, products: 3, latestCount: { unitsOff: 12, isOld: false, source: 'three_pl_dashboard', date: '2026-10-15' } });
    expect(card('Kofi Appiah')).toMatchObject({ onHand: 99, reserved: 21, inTransit: 20 });
    expect(card('Kasapa Express')).toMatchObject({ onHand: 0 });
    const copybook = body.stockByLocation.find((r: any) => r.locationName === 'Logiswift' && r.productId === sku['MG-COPYBOOK-SET']);
    expect(copybook).toMatchObject({ onHand: 200, reserved: 116, count: { counted: 188, difference: 12, status: 'off' } });
    const kofi = body.stockByLocation.find((r: any) => r.locationName === 'Kofi Appiah' && r.productId === sku['MG-COPYBOOK-SET']);
    expect(kofi).toMatchObject({ onHand: 36, reserved: 21, inTransit: 20 });
    expect((await get(`/api/inventory/overview?product=${sku['MG-REFILL-PENS']}`)).body.stockByLocation.every((r: any) => r.productId === sku['MG-REFILL-PENS'])).toBe(true);
  });

  it('holders of the copybook set: the total row equals the product total', async () => {
    const { body } = await get(`/api/inventory/product/${sku['MG-COPYBOOK-SET']}/holders`);
    expect(body.holders.map((h: any) => [h.name, h.onHand])).toEqual([['Kofi Appiah', 36], ['Logiswift', 200]]);
    expect(body.total.onHand).toBe(236);
    expect(body.productTotal).toBe(236);
    expect(body.holders.find((h: any) => h.name === 'Kofi Appiah')).toMatchObject({ inTransit: 20, allocated: 36 });
    expect(body.holders.find((h: any) => h.name === 'Logiswift')).toMatchObject({ returned: 41, count: { difference: 12 } });
    expect(body.holdersWithNone).toEqual(['Esi Badu', 'Kasapa Express', 'Kwesi Amoah']);
  });

  it('levels: Logiswift 200 / 62 / 180', async () => {
    const { body } = await get(`/api/inventory/levels?locationId=${loc['Logiswift']}`);
    expect(Object.fromEntries(body.levels.map((l: any) => [l.sku, l.onHand]))).toEqual({ 'MG-COPYBOOK-SET': 200, 'MG-REFILL-PENS': 62, 'MG-GRIP-TRAINER': 180 });
  });

  it('history: 9 movements, filtered by type with tab counts', async () => {
    const all = await get('/api/inventory/transfers?limit=100');
    expect(all.body.pagination.total).toBe(9);
    expect(all.body.typeCounts).toEqual({ opening: 6, receipt: 1, allocation: 1, return_to_warehouse: 1 });
    const returns = await get('/api/inventory/transfers?type=return_to_warehouse');
    expect(returns.body.transfers).toHaveLength(1);
    expect(returns.body.transfers[0]).toMatchObject({ quantity: 41, receivedQuantity: 36, shortQuantity: 5, status: 'disputed' });
  });

  it('returns: sent 41, received 36, missing 5, GH₵150.00 at GH₵30, and one Finding', async () => {
    const res = await get('/api/inventory/returns/summary?from=2026-10-01&to=2026-10-31');
    expect(res.body.total).toEqual({ sent: 41, received: 36, missing: 5, value: '150.00' });
    expect(res.body.partners).toMatchObject([{ name: 'Logiswift', sent: 41, received: 36, missing: 5, value: '150.00' }]);
    await get('/api/inventory/returns/summary');
    const findings = await prismaBase.finding.findMany({ where: { tenantId, type: 'stock_gap', subjectType: 'return_missing' } });
    expect(findings).toHaveLength(1);
    expect(findings[0].amount?.toFixed(2)).toBe('150.00');
  });

  it('a new count of Logiswift copybook 188 against 200 opens a Finding of 12 x GH₵30', async () => {
    const res = await request(app).post('/api/inventory/counts').set(bearer(ownerToken))
      .send({ locationId: loc['Logiswift'], countDate: '2026-10-17', source: 'three_pl_dashboard', lines: [{ productId: sku['MG-COPYBOOK-SET'], countedQuantity: 188 }] });
    expect(res.status).toBe(201);
    // 200 on hand, 188 counted: 12 units at the fixture cost GH₵30 (the landed cost 30.2083 arrives with the receive service)
    expect(res.body.count.lines[0]).toMatchObject({ systemQuantity: 200, difference: -12, finding: { status: 'open', amount: '360.00' } });
  });
});

describe('products on the fixture (T16)', () => {
  const MONTH = 'month=2026-10';
  const byName = (body: any) => Object.fromEntries(body.products.map((p: any) => [p.sku, p]));

  it('best seller this month: the copybook set, 306 delivered; on hand 236 over the two holders; 170 reserved over all partners', async () => {
    const { body } = await get(`/api/products?tab=all&${MONTH}&limit=100`);
    const p = byName(body);
    expect(p['MG-COPYBOOK-SET']).toMatchObject({ deliveredInPeriod: 306, onHandTotal: 236, reservedTotal: 170, marginPct: 88 }); // reserved: 116 + 21 at the two holders with stock, 33 at partners without a level
    expect(p['MG-REFILL-PENS'].deliveredInPeriod).toBe(172);
    expect(p['MG-GRIP-TRAINER'].deliveredInPeriod).toBe(89);
    expect(p['MG-PARENT-GUIDE'].deliveredInPeriod).toBe(58);
    const summary = (await get(`/api/products/summary?${MONTH}`)).body;
    expect(summary.bestSeller).toMatchObject({ name: 'Magic Groove copybook set', units: 306 });
    expect(summary.activeProducts).toEqual({ active: 5, archived: 0 });
  });

  it('margin per row 88% / 70% / 69% / 95%, the cream (no cost set) has none, and the tile average is 86%', async () => {
    const p = byName((await get(`/api/products?tab=all&${MONTH}&limit=100`)).body);
    expect([p['MG-COPYBOOK-SET'], p['MG-REFILL-PENS'], p['MG-GRIP-TRAINER'], p['MG-PARENT-GUIDE']].map((x) => x.marginPct)).toEqual([88, 70, 69, 95]);
    expect(p['DT-CREAM'].marginPct).toBeNull();
    // Sum of units x (price - cost) over sum of units x price, the cream left out because it has no cost: 77,214 / 89,611
    expect((await get(`/api/products/summary?${MONTH}`)).body.averageMargin).toBe(86);
  });

  it('a call rep gets no cost field; PATCH /api/products/:id/stock is a 404', async () => {
    const rep = await prismaBase.user.findFirstOrThrow({ where: { tenantId, role: 'sales_rep' } });
    const repToken = generateAccessToken({ id: rep.id, email: rep.email, role: 'sales_rep', tenantId });
    const res = await request(app).get('/api/products?tab=all&limit=100').set(bearer(repToken));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/cogs|marginPct/);
    expect((await request(app).patch(`/api/products/${sku['MG-COPYBOOK-SET']}/stock`).set(bearer(ownerToken)).send({ stockQuantity: 5 })).status).toBe(404);
  });

  it('the MCP tool products_inventory reads the levels, not the cached number', async () => {
    await prismaBase.product.update({ where: { id: sku['MG-COPYBOOK-SET'] }, data: { stockQuantity: 999 } });
    const out = await toolData('products_inventory', {}, tenantId);
    expect(out.products.find((x: any) => x.sku === 'MG-COPYBOOK-SET').stock).toBe(236);
    await prismaBase.product.update({ where: { id: sku['MG-COPYBOOK-SET'] }, data: { stockQuantity: 236 } });
  });
});
