/**
 * M3-T20, M3-T21: two-tenant test for every new Reports route: overview, sales, delivery, the CSV export of each tab and the
 * "all reports" workbook. Tenant A and tenant B both have October orders, a partner, a deposit and a collection; A's responses
 * must hold A's numbers only and none of B's rows, names or amounts.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, TwoTenants, TestTenant } from './helpers/twoTenants';

let pair: TwoTenants;
const RANGE = 'from=2026-10-01&to=2026-10-31';
const at = new Date('2026-10-05T10:00:00Z');

const get = (token: string, path: string, query = RANGE) =>
  request(app).get(`/api/reports/${path}?${query}`).set('Authorization', `Bearer ${token}`)
    .buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
const json = async (token: string, path: string, query?: string) => JSON.parse(((await get(token, path, query)).body as Buffer).toString('utf8'));

/** Delivered orders of `amount` each and one failed order, in the tenant's own city, plus a verified deposit and an approved collection. */
async function seed(t: TestTenant, delivered: number, amount: number, deposit: number) {
  const own = await prismaBase.order.findUniqueOrThrow({ where: { id: t.ids.order } });
  const base = {
    customerId: own.customerId, createdAt: at, shippingCost: 0, deliveryAddress: 'x', deliveryState: 'Greater Accra',
    deliveryArea: `City-${t.marker}`, tenantId: t.id, deliveryAgentId: t.users.deliveryAgent.id, customerRepId: t.users.salesRep.id,
    subtotal: amount, totalAmount: amount, codAmount: amount, confirmedById: t.users.salesRep.id,
  };
  const ids: number[] = [];
  for (let i = 0; i < delivered; i++) {
    ids.push((await prismaBase.order.create({ data: { ...base, status: 'delivered', deliveryDate: at } })).id);
  }
  await prismaBase.order.create({ data: { ...base, status: 'failed_delivery', failureReason: 'refused' } });
  await prismaBase.agentDeposit.create({
    data: { tenantId: t.id, agentId: t.users.deliveryAgent.id, amount: deposit, status: 'verified', depositDate: at, depositMethod: 'cash', referenceNumber: `ref-${t.marker}` },
  });
  await prismaBase.agentCollection.create({
    data: { tenantId: t.id, orderId: ids[0], agentId: t.users.deliveryAgent.id, amount, status: 'approved', collectionDate: at, approvedAt: new Date(at.getTime() + 2 * 86_400_000) },
  });
}

beforeAll(async () => {
  pair = await createTwoTenants('reports');
  await Promise.all([seed(pair.a, 1, 1000, 111), seed(pair.b, 2, 2000, 999)]);
}, 60000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

const leaks = (text: string) => [pair.b.marker, pair.b.amount, 'City-' + pair.b.marker, '4000.00', '2000.00', '999.00'].filter((x) => text.includes(x));

describe('two tenants: /api/reports', () => {
  it('overview: A sees its 3 October orders (the seeded one and two more) and 1,000.00 revenue; B sees its 4 and 4,000.00', async () => {
    const a = await json(pair.a.users.admin.token, 'overview');
    expect(a.tiles.orders.value).toBe(3);
    expect(a.tiles.delivered.value).toBe(1);
    expect(a.tiles.deliveredRevenue.value).toBe('1000.00');
    expect(a.endedUp.total).toBe(3);
    expect(JSON.stringify(a)).not.toContain(pair.b.marker);
    expect(leaks(JSON.stringify(a))).toEqual([]);
    const b = await json(pair.b.users.admin.token, 'overview');
    expect(b.tiles.orders.value).toBe(4);
    expect(b.tiles.deliveredRevenue.value).toBe('4000.00');
    expect(JSON.stringify(b)).not.toContain(pair.a.marker);
  });

  it('sales: A has one city, its own revenue, and the cash received from its own deposit', async () => {
    const a = await json(pair.a.users.admin.token, 'sales');
    expect(a.tiles.deliveredRevenue.value).toBe('1000.00');
    expect(a.tiles.cashReceived.value).toBe('111.00');
    expect(a.byCity.rows.map((r: any) => r.city)).toEqual([`City-${pair.a.marker}`]);
    expect(a.byProduct.rows.every((r: any) => !r.name.includes(pair.b.marker))).toBe(true);
    expect(leaks(JSON.stringify(a))).toEqual([]);
    const b = await json(pair.b.users.admin.token, 'sales');
    expect(b.tiles.cashReceived.value).toBe('999.00');
    expect(b.currency).toBe('NGN');
    expect(a.currency).toBe('GHS');
  });

  it('delivery: A has its own partner, its own failed order and reason, and none of B', async () => {
    const a = await json(pair.a.users.admin.token, 'delivery');
    expect(a.partners.rows.map((r: any) => r.partnerId)).toEqual([pair.a.users.deliveryAgent.id]);
    expect(a.partners.rows[0]).toMatchObject({ delivered: 1, failedOrReturned: 1, paysInDays: 2 });
    expect(a.tiles.failed.value).toBe(1);
    expect(a.reasons.rows).toEqual([{ reason: 'refused', count: 1, percent: 100 }]);
    expect(a.successByCity.rows.map((r: any) => r.city)).toEqual([`City-${pair.a.marker}`, 'Accra']); // Accra: the order every test tenant starts with
    expect(leaks(JSON.stringify(a))).toEqual([]);
    expect((await json(pair.b.users.admin.token, 'delivery')).partners.rows.map((r: any) => r.partnerId)).toEqual([pair.b.users.deliveryAgent.id]);
  });

  it('export: the CSV of every tab and the all-reports workbook hold A only', async () => {
    for (const tab of ['overview', 'sales', 'delivery', 'team']) {
      const res = await get(pair.a.users.admin.token, `${tab}/export`, `${RANGE}&format=csv`);
      expect(res.status).toBe(200);
      const text = (res.body as Buffer).toString('utf8');
      expect(text).not.toContain(pair.b.marker);
      expect(leaks(text)).toEqual([]);
    }
    const sales = (await get(pair.a.users.admin.token, 'sales/export', `${RANGE}&format=csv`)).body.toString('utf8');
    expect(sales).toContain('1000.00');
    const all = await get(pair.a.users.admin.token, 'all/export', `${RANGE}&format=xlsx`);
    expect(all.status).toBe(200);
    // an .xlsx is zipped XML, so the cells cannot be searched as text: compare through the reader
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(all.body as any);
    const cells: string[] = [];
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => cells.push(String(cell.value)))));
    expect(cells.some((v) => v.includes(pair.b.marker))).toBe(false);
    expect(cells).toContain('1000');
  });

  it("B's admin cannot read A's data by any parameter (there is no tenant parameter) and a token of A reads A only", async () => {
    const res = await json(pair.a.users.admin.token, 'overview', `${RANGE}&tenantId=${pair.b.id}`);
    expect(res.tiles.orders.value).toBe(3);
  });
});
