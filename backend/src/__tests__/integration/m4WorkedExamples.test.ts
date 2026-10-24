/**
 * M4-T34 (COD-46 part 1): the worked-example gaps. The audit found most numbers asserted already:
 *   shipment 300 / 288 / 12, landed 30.21, claim 324, one entry of 8,700, second receive 409, claim settle and write-off (shipmentReceive);
 *   count 200 vs 188 with 12 x 30.2083 = 362.50 (stockCountsApi); transfer dispute, return to source and write-off (transfersApi);
 *   returns 41 / 36 / 5 and Finding 150 (inventoryFixtureApi); one stock_gap Finding for negative stock (stockOnce);
 *   stock cache check (stockCheck); fixture values 442 / 116 / 99 / 36 / 21 / 20 (inventoryFixtureApi, fixtureChecks/stock);
 *   Done-when 3 (stockOnce), 7 (stockWriteGrep, transfersApi old routes), 9 (deliveryPartnersWrite).
 * This file adds what only the fixture can show: the cache check on the fixture, available to sell through the service,
 * and Done-when 2 on the fixture count.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { generateAccessToken } from '../../utils/jwt';
import { bearer } from './helpers/superAdminToken';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';
import { getAvailableMany } from '../../services/stockService';
import { checkStockForTenant } from '../../services/stockCheckService';

jest.setTimeout(240_000);

let tenantId: string;
let ownerToken: string;
const sku: Record<string, number> = {};
const loc: Record<string, number> = {};

beforeAll(async () => {
  tenantId = (await seedFixture(prismaBase)).tenantId;
  const owner = await prismaBase.user.create({ data: { email: `m4we-owner-${Date.now()}@codadmin.test`, password: 'x', firstName: 'Owner', lastName: 'T', role: 'super_admin', tenantId } });
  ownerToken = generateAccessToken({ id: owner.id, email: owner.email, role: 'super_admin', tenantId });
  for (const p of await prismaBase.product.findMany({ where: { tenantId } })) sku[p.sku] = p.id;
  for (const l of await prismaBase.stockLocation.findMany({ where: { tenantId } })) loc[l.name] = l.id;
});

afterAll(async () => {
  await prismaBase.stockCountLine.deleteMany({ where: { tenantId } });
  await prismaBase.finding.deleteMany({ where: { tenantId, subjectType: { in: ['return_missing', 'stock_count_line', 'product_cache'] } } });
  await prismaBase.auditLog.deleteMany({ where: { tenantId } });
  await deleteFixtureRows(prismaBase, tenantId);
  await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  await prismaBase.$disconnect();
});

describe('stock cache on the fixture', () => {
  it('the nightly check finds no product whose cache differs from the levels, and opens no Finding', async () => {
    const result = await checkStockForTenant(tenantId);
    expect(result.differing).toEqual([]);
    expect(result.checked).toBe(await prismaBase.product.count({ where: { tenantId, productType: { not: 'digital' } } })); // digital products are not checked
    expect(result.checked).toBeGreaterThan(0);
    expect(await prismaBase.finding.count({ where: { tenantId, type: 'stock_gap', subjectType: 'product_cache' } })).toBe(0);
  });
});

describe('available to sell on the fixture (Done when 5)', () => {
  it('no physical product has a negative available to sell; the copybook set has 236 on hand less 170 reserved', async () => {
    const products = await prismaBase.product.findMany({ where: { tenantId, productType: { not: 'digital' } }, select: { id: true, sku: true } });
    const available = await runInTenant(tenantId, () => getAvailableMany(products.map((p) => p.id), prisma));
    expect(available.size).toBe(products.length);
    for (const p of products) expect([p.sku, available.get(p.id)! >= 0]).toEqual([p.sku, true]);
    expect(available.get(sku['MG-COPYBOOK-SET'])).toBe(236 - 170);
  });
});

describe('the Finding of the 3PL count (Done when 2)', () => {
  const countLogiswift = () => request(app).post('/api/inventory/counts').set(bearer(ownerToken))
    .send({ locationId: loc['Logiswift'], countDate: '2026-10-17', source: 'three_pl_dashboard', lines: [{ productId: sku['MG-COPYBOOK-SET'], countedQuantity: 188 }] });

  it('a count of 188 against 200 opens one open stock_gap Finding for 12 units, at the cost the product carries', async () => {
    const res = await countLogiswift();
    expect(res.status).toBe(201);
    const line = res.body.count.lines[0];
    expect(line).toMatchObject({ systemQuantity: 200, countedQuantity: 188, difference: -12, finding: { status: 'open' } });
    const cogs = Number((await prismaBase.product.findUniqueOrThrow({ where: { id: sku['MG-COPYBOOK-SET'] } })).cogs);
    expect(Number(line.finding.amount)).toBe(12 * cogs);
  });

  // Done when 2 says the Finding is GH₵362.50 (12 x 30.21, the landed cost of the 9 October shipment). The service prices the gap
  // at Product.cogs, and the fixture product carries GH₵30.00 (the receive service would move it to a weighted average), so the
  // fixture gives 360.00. Opus decides: the fixture cost, or the Finding priced at the landed cost.
  it.failing('the fixture Finding is GH₵362.50', async () => {
    const res = await countLogiswift();
    expect(res.status).toBe(201);
    expect(res.body.count.lines[0].finding.amount).toBe('362.50');
  });
});
