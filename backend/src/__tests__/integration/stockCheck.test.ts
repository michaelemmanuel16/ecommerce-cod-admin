/**
 * M4-T17 (F-660): the nightly stock check. Change the cached total by hand: the job opens one Finding at difference x
 * cost, a second run opens no duplicate (it updates the amount), a clean tenant opens none, and a tenant never sees
 * another tenant's gap. Two throwaway tenants on the test DB.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { stockUp } from './helpers/stock';
import { checkStockForTenant, runStockCheck } from '../../services/stockCheckService';

jest.setTimeout(120_000);

const SUFFIX = Date.now();
let tenantA: string;
let tenantB: string;
let copybook: number;
let pens: number;
let oldBook: number;

const mkProduct = (tenantId: string, sku: string, extra: Record<string, unknown> = {}) =>
  prismaBase.product.create({ data: { sku: `SC-${sku}-${SUFFIX}`, name: sku, category: 'x', price: 50, cogs: 30, stockQuantity: 0, tenantId, ...extra } }).then((p) => p.id);
const findings = (tenantId: string) => prismaBase.finding.findMany({ where: { tenantId, type: 'stock_gap', subjectType: 'product_cache' }, orderBy: { id: 'asc' } });
const setCache = (id: number, stockQuantity: number) => prismaBase.product.update({ where: { id }, data: { stockQuantity } });

beforeAll(async () => {
  tenantA = (await createTenant('Stock Check A')).id;
  tenantB = (await createTenant('Stock Check B')).id;
  copybook = await mkProduct(tenantA, 'Copybook');
  pens = await mkProduct(tenantA, 'Pens');
  await mkProduct(tenantA, 'Ebook', { productType: 'digital' });
  oldBook = await mkProduct(tenantA, 'Old', { isActive: false });
  await stockUp(tenantA, copybook, 200, { name: 'Swift', type: 'partner_3pl' });
  await stockUp(tenantA, pens, 62, { name: 'Swift', type: 'partner_3pl' });
  await stockUp(tenantA, oldBook, 5, { name: 'Swift', type: 'partner_3pl' });
  // Tenant B: a clean tenant
  const bProduct = await mkProduct(tenantB, 'Bcopy');
  await stockUp(tenantB, bProduct, 40, { name: 'B store', type: 'own_store' });
});

afterAll(async () => {
  await deleteTenantRows([tenantA, tenantB]);
  await prismaBase.$disconnect();
});

describe('nightly stock check', () => {
  it('a clean tenant opens no Finding; digital products are not checked', async () => {
    expect(await checkStockForTenant(tenantA)).toEqual({ checked: 3, differing: [] });
    expect(await checkStockForTenant(tenantB)).toMatchObject({ differing: [] });
    expect(await findings(tenantA)).toHaveLength(0);
    expect(await findings(tenantB)).toHaveLength(0);
  });

  it('changing the cache by hand opens one Finding at difference x cost; the job changes no quantity', async () => {
    await setCache(copybook, 188); // locations hold 200: 12 short, cost 30
    const result = await checkStockForTenant(tenantA);
    expect(result.differing).toEqual([copybook]);
    const rows = await findings(tenantA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'open', subjectId: String(copybook) });
    expect(rows[0].amount?.toFixed(2)).toBe('360.00');
    expect(rows[0].note).toContain('stored total is 188');
    expect((await prismaBase.product.findUniqueOrThrow({ where: { id: copybook } })).stockQuantity).toBe(188);
  });

  it('a second run opens no duplicate; if the gap changes, the open Finding takes the new amount', async () => {
    await checkStockForTenant(tenantA);
    expect(await findings(tenantA)).toHaveLength(1);
    await setCache(copybook, 190);
    await checkStockForTenant(tenantA);
    const rows = await findings(tenantA);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount?.toFixed(2)).toBe('300.00');
  });

  it('one Finding per differing product, archived products included, a cache above the levels too', async () => {
    await setCache(pens, 70);
    await setCache(oldBook, 0);
    const result = await checkStockForTenant(tenantA);
    expect(result.differing.sort()).toEqual([copybook, pens, oldBook].sort());
    const rows = await findings(tenantA);
    expect(rows.map((r) => r.subjectId).sort()).toEqual([copybook, pens, oldBook].map(String).sort());
    expect(rows.find((r) => r.subjectId === String(pens))?.amount?.toFixed(2)).toBe('240.00');
  });

  it('the run over all tenants works inside each tenant: B stays clean, A is not repeated', async () => {
    await runStockCheck();
    expect(await findings(tenantB)).toHaveLength(0);
    expect(await findings(tenantA)).toHaveLength(3);
  });

  it('a closed Finding does not stop a new one while the gap remains', async () => {
    await prismaBase.finding.updateMany({ where: { tenantId: tenantA, subjectId: String(pens) }, data: { status: 'closed' } });
    await checkStockForTenant(tenantA);
    expect((await findings(tenantA)).filter((r) => r.subjectId === String(pens))).toHaveLength(2);
  });

  it('after the cache is put right the job opens nothing new', async () => {
    await setCache(copybook, 200);
    await setCache(pens, 62);
    await setCache(oldBook, 5);
    const before = (await findings(tenantA)).length;
    expect((await checkStockForTenant(tenantA)).differing).toEqual([]);
    expect((await findings(tenantA)).length).toBe(before);
  });
});
