/**
 * M4-T12 (F-606, F-608, F-611): receive a shipment and settle its supplier claim, through the routes. The worked example of
 * the plan: 300 shipped at GH₵27.00, shipping 450, other 150 (total 8,700); 288 counted, 12 short; landed cost 8,700 / 288
 * (30.21, not 29.00); product cost becomes the weighted average; claim 12 x 27 = 324; one stock_gap Finding; one ledger entry
 * DR 1200 / CR 1010 of 8,700; a second receive is 409 and two at once leave one winner. Then the claim: settled posts
 * DR 1010 / CR 1200 once, written off posts nothing.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { cacheOf, levelAt, stockUp } from './helpers/stock';

jest.setTimeout(180_000);

const SUFFIX = Date.now();
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const TODAY = day(0);
const YESTERDAY = day(1);
const LAST_WEEK = day(7);
let tenantId: string;
let owner: { id: number; token: string };
let manager: { id: number; token: string };
let copybook: number;
let store: number;
let swift: number;
let transit: number;

const api = (method: 'get' | 'post', who: { token: string }, path: string, body?: Record<string, unknown>) =>
  request(app)[method](`/api/shipments${path}`).set(bearer(who.token)).send(body);
const newShipment = async (extra: Record<string, unknown> = {}) => {
  const res = await api('post', owner, '', { productId: copybook, supplier: 'Accra Print House', quantity: 300, unitCost: 27, shippingCost: 450, customsDuties: 0, otherCosts: 150, ...extra });
  expect(res.status).toBe(201);
  return res.body.id as number;
};
const receive = (id: number, extra: Record<string, unknown> = {}) =>
  api('post', owner, `/${id}/receive`, { locationId: swift, receivedAt: YESTERDAY, quantityCounted: 288, countSource: 'own_count', ...extra });
const entries = (id: number) => prismaBase.journalEntry.findMany({
  where: { tenantId, sourceType: { in: ['inventory_purchase', 'inventory_claim'] }, sourceId: id }, orderBy: { id: 'asc' }, include: { transactions: { include: { account: true } } },
});
const lines = (entry: Awaited<ReturnType<typeof entries>>[number]) =>
  entry.transactions.map((t) => [t.account.code, Number(t.debitAmount), Number(t.creditAmount)]).sort();
const productCost = async () => (await prismaBase.product.findUniqueOrThrow({ where: { id: copybook } })).cogs!.toFixed(4);
const movements = (id: number) => prismaBase.inventoryTransfer.findMany({ where: { tenantId, shipmentId: id } });

beforeAll(async () => {
  tenantId = (await createTenant('Shipment Receive', { currency: 'GHS' })).id;
  await seedTenantDefaults(tenantId);
  owner = await mkUser(tenantId, 'owner', 'super_admin');
  manager = await mkUser(tenantId, 'manager', 'manager');
  copybook = (await prismaBase.product.create({ data: { sku: `SR-COPY-${SUFFIX}`, name: 'Copybook set', category: 'x', price: 249, cogs: 30, stockQuantity: 0, tenantId } })).id;
  store = await stockUp(tenantId, copybook, 100, { name: 'Own store' }); // 100 on hand before the first receipt
  swift = (await prismaBase.stockLocation.create({ data: { tenantId, name: 'Swift 3PL', type: 'partner_3pl' } })).id;
  transit = (await prismaBase.stockLocation.create({ data: { tenantId, name: 'In transit', type: 'in_transit' } })).id;
  await prismaBase.fxRate.createMany({
    data: [
      { tenantId, fromCurrency: 'GHS', toCurrency: 'CNY', rate: '0.625', date: new Date(`${TODAY}T00:00:00Z`), source: 'auto' }, // 1 CNY = 1.6
      { tenantId, fromCurrency: 'GHS', toCurrency: 'CNY', rate: '0.5', date: new Date(`${YESTERDAY}T00:00:00Z`), source: 'auto' }, // 1 CNY = 2
      { tenantId, fromCurrency: 'GHS', toCurrency: 'CNY', rate: '0.4', date: new Date(`${LAST_WEEK}T00:00:00Z`), source: 'auto' }, // 1 CNY = 2.5
    ],
  });
}, 60_000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('the worked example (300 shipped, 288 counted)', () => {
  let id: number;
  let body: any;

  it('receives: total 8,700, counted 288, short 12, landed 30.21, claim 324', async () => {
    id = await newShipment();
    const res = await receive(id);
    expect(res.status).toBe(200);
    body = res.body;
    expect(body.status).toBe('received');
    expect([Number(body.totalCostStore), body.quantityCounted, body.shortQuantity]).toEqual([8700, 288, 12]);
    expect(Number(body.landedCostPerUnit)).toBe(30.21);
    expect(Number(body.landedCostPerUnit)).not.toBe(29);
    expect([body.claimStatus, Number(body.claimAmount)]).toEqual(['open', 324]);
    expect(body.destinationLocation.id).toBe(swift);
    const row = await prismaBase.inventoryShipment.findUniqueOrThrow({ where: { id } });
    expect(row.landedCostPerUnit!.toFixed(4)).toBe('30.2083');
    expect(row.receivedById).toBe(owner.id);
  });

  it('one receipt movement for 288 at the location, the cache follows', async () => {
    const moves = await movements(id);
    expect(moves.map((m) => [m.transferType, m.quantity, m.toLocationId, m.status])).toEqual([['receipt', 288, swift, 'received']]);
    expect(await levelAt(swift, copybook)).toBe(288);
    expect(await cacheOf(copybook)).toBe(388);
  });

  it('product cost is the weighted average: (100 x 30 + 288 x 30.2083) / 388', async () => {
    expect(await productCost()).toBe(((100 * 30 + 288 * 30.2083) / 388).toFixed(4)); // 30.1546
  });

  it('one ledger entry for the full total: DR 1200 / CR 1010 of 8,700, dated the received date', async () => {
    const list = await entries(id);
    expect(list).toHaveLength(1);
    expect(lines(list[0])).toEqual([['1010', 0, 8700], ['1200', 8700, 0]]);
    expect(list[0].entryDate.toISOString().slice(0, 10)).toBe(YESTERDAY);
    const row = await prismaBase.inventoryShipment.findUniqueOrThrow({ where: { id } });
    expect(row.glJournalEntryId).toBe(list[0].id);
  });

  it('one open stock_gap Finding of 324 for the shipment', async () => {
    const findings = await prismaBase.finding.findMany({ where: { tenantId, subjectType: 'inventory_shipment', subjectId: String(id) } });
    expect(findings.map((f) => [f.type, f.status, Number(f.amount)])).toEqual([['stock_gap', 'open', 324]]);
  });

  it('a second receive is 409 and adds nothing', async () => {
    const res = await receive(id);
    expect(res.status).toBe(409);
    expect(await movements(id)).toHaveLength(1);
    expect(await entries(id)).toHaveLength(1);
    expect(await cacheOf(copybook)).toBe(388);
  });

  it('writes an audit row for the receive', async () => {
    const rows = await prismaBase.auditLog.findMany({ where: { tenantId, resource: 'inventory_shipment', resourceId: String(id), action: 'receive' } });
    expect(rows).toHaveLength(1);
  });

  it('GET shows the received shipment with its landed cost and claim', async () => {
    const res = await api('get', owner, `/${id}`);
    expect([res.body.status, res.body.quantityCounted, Number(res.body.landedCostPerUnit), Number(res.body.claimAmount)]).toEqual(['received', 288, 30.21, 324]);
  });
});

describe('receive rules', () => {
  it('two receives at once: one wins, one gets 409, one movement, one entry', async () => {
    const id = await newShipment({ quantity: 10, unitCost: 1, shippingCost: 0, otherCosts: 0 });
    const before = await cacheOf(copybook);
    const [a, b] = await Promise.all([receive(id, { quantityCounted: 10 }), receive(id, { quantityCounted: 10 })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await movements(id)).toHaveLength(1);
    expect(await entries(id)).toHaveLength(1);
    expect(await cacheOf(copybook)).toBe(before + 10);
  });

  it('counted 0 gives a full-value claim, no movement, the old product cost, and the full total in the ledger', async () => {
    const id = await newShipment();
    const cost = await productCost();
    const before = await cacheOf(copybook);
    const res = await receive(id, { quantityCounted: 0 });
    expect(res.status).toBe(200);
    expect([res.body.quantityCounted, res.body.shortQuantity, res.body.landedCostPerUnit, res.body.claimStatus, Number(res.body.claimAmount)]).toEqual([0, 300, null, 'open', 8100]);
    expect(await movements(id)).toHaveLength(0);
    expect(await cacheOf(copybook)).toBe(before);
    expect(await productCost()).toBe(cost);
    expect(lines((await entries(id))[0])).toEqual([['1010', 0, 8700], ['1200', 8700, 0]]);
  });

  it('a full count has no claim and no Finding', async () => {
    const id = await newShipment({ quantity: 5, unitCost: 2, shippingCost: 0, otherCosts: 0 });
    const res = await receive(id, { quantityCounted: 5 });
    expect([res.body.shortQuantity, res.body.claimStatus, Number(res.body.claimAmount)]).toEqual([0, 'none', 0]);
    expect(await prismaBase.finding.count({ where: { tenantId, subjectType: 'inventory_shipment', subjectId: String(id) } })).toBe(0);
  });

  it('a future date is 400', async () => {
    const id = await newShipment();
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect((await receive(id, { receivedAt: tomorrow })).status).toBe(400);
    expect((await prismaBase.inventoryShipment.findUniqueOrThrow({ where: { id } })).status).toBe('pending');
  });

  it('the in-transit location is 400; an unknown location is 404; more than shipped is 400', async () => {
    const id = await newShipment();
    expect((await receive(id, { locationId: transit })).status).toBe(400);
    expect((await receive(id, { locationId: 999999999 })).status).toBe(404);
    expect((await receive(id, { quantityCounted: 301 })).status).toBe(400);
    expect((await receive(id, { countSource: 'guess' })).status).toBe(400);
    expect((await prismaBase.inventoryShipment.findUniqueOrThrow({ where: { id } })).status).toBe('pending');
    expect(await movements(id)).toHaveLength(0);
  });

  it('three_pl_dashboard writes one StockCount with its line (system = shipped, counted)', async () => {
    const id = await newShipment();
    expect((await receive(id, { countSource: 'three_pl_dashboard' })).status).toBe(200);
    const counts = await prismaBase.stockCount.findMany({ where: { tenantId, note: `Shipment ${id} received` }, include: { lines: true } });
    expect(counts).toHaveLength(1);
    expect(counts[0].shipmentId).toBe(id); // the stored link to its shipment
    expect([counts[0].source, counts[0].locationId, counts[0].countDate.toISOString().slice(0, 10)]).toEqual(['three_pl_dashboard', swift, YESTERDAY]);
    expect(counts[0].lines.map((l) => [l.productId, l.systemQuantity, l.countedQuantity, l.difference])).toEqual([[copybook, 300, 288, -12]]);
  });

  it('own_count and agent_count write no StockCount', async () => {
    const id = await newShipment({ quantity: 4, unitCost: 1, shippingCost: 0, otherCosts: 0 });
    await receive(id, { quantityCounted: 4, countSource: 'agent_count' });
    expect(await prismaBase.stockCount.count({ where: { tenantId, shipmentId: id } })).toBe(0);
  });

  it('a CNY shipment takes the rate of the received date, not of the day it was added', async () => {
    const id = await newShipment({ currency: 'CNY', quantity: 100, unitCost: 10, shippingCost: 0, otherCosts: 0 }); // 1,000 CNY, added at 1.6
    const res = await receive(id, { quantityCounted: 100, receivedAt: LAST_WEEK }); // 1 CNY = 2.5 that day
    expect(res.status).toBe(200);
    expect([Number(res.body.totalCostStore), Number(res.body.fxRate), Number(res.body.landedCostPerUnit)]).toEqual([2500, 2.5, 25]);
    expect(lines((await entries(id))[0])).toEqual([['1010', 0, 2500], ['1200', 2500, 0]]);
  });

  it('a typed rate at receive is marked manual', async () => {
    const id = await newShipment({ currency: 'CNY', quantity: 10, unitCost: 10, shippingCost: 0, otherCosts: 0 });
    const res = await receive(id, { quantityCounted: 10, fxRate: 3 });
    expect([res.body.fxRateSource, Number(res.body.totalCostStore)]).toEqual(['manual', 300]);
  });

  it('claim amount of a foreign shipment is short x unit cost at the same rate', async () => {
    const id = await newShipment({ currency: 'CNY', quantity: 10, unitCost: 10, shippingCost: 0, otherCosts: 0 });
    const res = await receive(id, { quantityCounted: 8, fxRate: 3 });
    expect(Number(res.body.claimAmount)).toBe(60); // 2 short x 10 CNY x 3
  });

  it('a manager gets 403', async () => {
    const id = await newShipment();
    expect((await api('post', manager, `/${id}/receive`, { locationId: swift, receivedAt: YESTERDAY, quantityCounted: 1, countSource: 'own_count' })).status).toBe(403);
  });
});

describe('the supplier claim (F-608)', () => {
  const claim = (id: number, body: Record<string, unknown>) => api('post', owner, `/${id}/claim`, body);
  const received = async () => {
    const id = await newShipment();
    await receive(id);
    return id;
  };

  it('settle with an amount posts DR 1010 / CR 1200 once and closes the Finding', async () => {
    const id = await received();
    const res = await claim(id, { action: 'settle', amountRecovered: 300 });
    expect(res.status).toBe(200);
    expect([res.body.claimStatus, Number(res.body.claimRecovered)]).toEqual(['settled', 300]);
    const list = await entries(id);
    expect(list).toHaveLength(2); // the purchase and the claim
    const claimEntry = list.find((e) => e.sourceType === 'inventory_claim')!;
    expect(lines(claimEntry)).toEqual([['1010', 300, 0], ['1200', 0, 300]]);
    expect((await prismaBase.inventoryShipment.findUniqueOrThrow({ where: { id } })).claimJournalEntryId).toBe(claimEntry.id);
    const finding = await prismaBase.finding.findFirstOrThrow({ where: { tenantId, subjectType: 'inventory_shipment', subjectId: String(id) } });
    expect(finding.status).toBe('explained');
  });

  it('a second settle is 409 and posts nothing more', async () => {
    const id = await received();
    expect((await claim(id, { action: 'settle', amountRecovered: 100 })).status).toBe(200);
    expect((await claim(id, { action: 'settle', amountRecovered: 100 })).status).toBe(409);
    expect((await claim(id, { action: 'write_off' })).status).toBe(409);
    expect(await entries(id)).toHaveLength(2);
  });

  it('two settles at once: one wins', async () => {
    const id = await received();
    const [a, b] = await Promise.all([claim(id, { action: 'settle', amountRecovered: 50 }), claim(id, { action: 'settle', amountRecovered: 50 })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await entries(id)).toHaveLength(2);
  });

  it('the amount must be above 0 and not above the claim of 324', async () => {
    const id = await received();
    expect((await claim(id, { action: 'settle', amountRecovered: 0 })).status).toBe(400);
    expect((await claim(id, { action: 'settle', amountRecovered: 324.01 })).status).toBe(400);
    expect((await claim(id, { action: 'settle' })).status).toBe(400);
    expect((await claim(id, { action: 'settle', amountRecovered: 324 })).status).toBe(200);
  });

  it('write-off posts nothing and closes the Finding', async () => {
    const id = await received();
    const res = await claim(id, { action: 'write_off', note: 'Supplier refused' });
    expect(res.status).toBe(200);
    expect([res.body.claimStatus, res.body.claimNote]).toEqual(['written_off', 'Supplier refused']);
    expect(await entries(id)).toHaveLength(1); // only the purchase
    const finding = await prismaBase.finding.findFirstOrThrow({ where: { tenantId, subjectType: 'inventory_shipment', subjectId: String(id) } });
    expect(finding.status).toBe('explained');
  });

  it('a shipment with no claim, or a pending one, is 409; an unknown action is 400', async () => {
    const pending = await newShipment();
    expect((await claim(pending, { action: 'write_off' })).status).toBe(409);
    const full = await newShipment({ quantity: 3, unitCost: 1, shippingCost: 0, otherCosts: 0 });
    await receive(full, { quantityCounted: 3 });
    expect((await claim(full, { action: 'settle', amountRecovered: 1 })).status).toBe(409);
    expect((await claim(full, { action: 'refund' })).status).toBe(400);
  });

  it('audit rows for settle and write-off', async () => {
    const a = await received();
    await claim(a, { action: 'settle', amountRecovered: 10 });
    const b = await received();
    await claim(b, { action: 'write_off' });
    expect(await prismaBase.auditLog.count({ where: { tenantId, resourceId: String(a), action: 'claim_settle' } })).toBe(1);
    expect(await prismaBase.auditLog.count({ where: { tenantId, resourceId: String(b), action: 'claim_write_off' } })).toBe(1);
  });
});

describe('old arrived rows (migration 20261024100000)', () => {
  it('become received with counted = quantity, short = 0, received_at = arrived_at, and keep their own entry id', async () => {
    const arrivedAt = new Date('2026-09-01T10:00:00Z');
    const old = await prismaBase.inventoryShipment.create({
      data: { tenantId, productId: copybook, quantity: 120, unitCost: 5, totalCost: 600, status: 'arrived', arrivedAt, createdById: owner.id },
    });
    const pending = await prismaBase.inventoryShipment.create({ data: { tenantId, productId: copybook, quantity: 9, unitCost: 1, totalCost: 9, createdById: owner.id } });
    const sql = fs.readFileSync(path.join(__dirname, '../../../prisma/migrations/20261024100000_m4_arrived_shipments_to_received/migration.sql'), 'utf8');
    await prismaBase.$executeRawUnsafe(sql);
    const row = await prismaBase.inventoryShipment.findUniqueOrThrow({ where: { id: old.id } });
    expect([row.status, row.quantityCounted, row.shortQuantity, row.receivedAt?.toISOString(), row.glJournalEntryId]).toEqual(['received', 120, 0, arrivedAt.toISOString(), null]);
    expect((await prismaBase.inventoryShipment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('pending');
    expect(await entries(old.id)).toHaveLength(0);
  });
});
