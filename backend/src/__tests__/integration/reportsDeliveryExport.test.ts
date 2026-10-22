/**
 * M3-T21 (F-1053, F-1057, F-1050): GET /api/reports/delivery and GET /api/reports/:tab/export on the numbers fixture, clock
 * fixed at 17 October 2026, 13:00. Failed 354 and returned 48 apart, the reasons, the partner table against kpi.partnerRates,
 * the cash tiles with deposits, tab permissions, the CSV and Excel files against the JSON, the "all reports" workbook and
 * the missing PDF route.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
// The 5-per-5-minutes limiter is proven in exportRateLimit.test.ts; here it would stop the suite
jest.mock('../../middleware/bulkRateLimiter', () => ({
  bulkOrderRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  bulkImportRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import request from 'supertest';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { clearPermissionsCache } from '../../middleware/auth';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';
import { partnerRates } from '../../services/kpi/partners';
import * as outcomes from '../../services/kpi/outcomes';
import { rates } from '../../services/kpi/rates';
import { endOfDay, startOfDay } from '../../services/kpi/dates';

jest.setTimeout(300_000);

const FIXTURE_NOW = new Date('2026-10-17T13:00:00Z');
const RANGE = 'from=2026-10-01&to=2026-10-17';
const ZONE = 'Africa/Accra';

let tenantId: string;
let adminToken: string;
let managerToken: string;
let accountantToken: string;
let repToken: string;
let kofiId: number;
const extraRows: { deposits: number[]; collections: number[] } = { deposits: [], collections: [] };

const get = (token: string | null, path: string, query = RANGE) => {
  const r = request(app).get(`/api/reports/${path}?${query}`);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
/** A file response as a Buffer. */
const file = (token: string | null, tab: string, query: string) =>
  get(token, `${tab}/export`, query).buffer(true).parse((res, done) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  });
const setManagerPermissions = async (resources: Record<string, string[]>) => {
  await prismaBase.systemConfig.updateMany({ where: { tenantId }, data: { rolePermissions: { manager: resources } as any } });
  clearPermissionsCache();
};

/** The sections of a CSV: blank lines split them; the first row is the title, the second the header. */
function csvSections(buffer: Buffer) {
  const rows: string[][] = parse(buffer.toString('utf8').replace(/^﻿/, ''), { relax_column_count: true, skip_empty_lines: false });
  return splitSections(rows);
}
function splitSections(rows: Array<Array<string | number | Date | null>>) {
  const out: Array<{ title: string; header: string[]; rows: Array<Array<any>> }> = [];
  let block: Array<Array<any>> = [];
  const flush = () => { if (block.length) out.push({ title: String(block[0][0]), header: block[1].map(String), rows: block.slice(2) }); block = []; };
  for (const r of rows) {
    if (r.every((v) => v === '' || v === null || v === undefined)) flush(); else block.push(r);
  }
  flush();
  return out;
}
async function xlsxSheets(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  return wb.worksheets.map((ws) => {
    const rows: any[][] = [];
    ws.eachRow({ includeEmpty: true }, (row) => rows.push((row.values as any[]).slice(1).map((v) => v ?? '')));
    return { name: ws.name, ws, sections: splitSections(rows) };
  });
}
const section = (sections: ReturnType<typeof splitSections>, title: string) => {
  const s = sections.find((x) => x.title === title);
  if (!s) throw new Error(`no section "${title}" in ${sections.map((x) => x.title).join(', ')}`);
  return s;
};

beforeAll(async () => {
  tenantId = (await seedFixture(prismaBase)).tenantId;
  const user = (role: string) => prismaBase.user.create({
    data: { email: `exp-${role}@fixture-numbers.test`, password: 'x', firstName: 'Exp', lastName: role, role: role as any, tenantId },
  });
  const [admin, manager, accountant, rep, kofi] = await Promise.all([
    prismaBase.user.findFirstOrThrow({ where: { tenantId, role: 'admin' } }),
    user('manager'), user('accountant'),
    prismaBase.user.findFirstOrThrow({ where: { tenantId, role: 'sales_rep' } }),
    prismaBase.user.findFirstOrThrow({ where: { tenantId, role: 'delivery_agent', firstName: 'Kofi' } }),
  ]);
  const token = (u: { id: number; email: string }, role: string) => generateAccessToken({ id: u.id, email: u.email, role: role as any, tenantId });
  adminToken = token(admin, 'admin');
  managerToken = token(manager, 'manager');
  accountantToken = token(accountant, 'accountant');
  repToken = token(rep, 'sales_rep');
  kofiId = kofi.id;
  if (!(await prismaBase.systemConfig.findFirst({ where: { tenantId } }))) await prismaBase.systemConfig.create({ data: { tenantId } });

  // Two approved collections of Kofi (3 and 4 days to approve) and deposits: 68,600 verified in the range counts; pending, rejected and out-of-range do not (5,000 sits in the previous period).
  const orders = await prismaBase.order.findMany({ where: { tenantId, deliveryAgentId: kofiId, status: 'delivered' }, take: 2, orderBy: { id: 'asc' } });
  const day = 86_400_000;
  const collected = new Date('2026-10-05T10:00:00Z');
  for (const [i, o] of orders.entries()) {
    const row = await prismaBase.agentCollection.create({
      data: { tenantId, orderId: o.id, agentId: kofiId, amount: 100, status: 'approved', collectionDate: collected, approvedAt: new Date(collected.getTime() + (3 + i) * day) },
    });
    extraRows.collections.push(row.id);
  }
  const deposit = async (amount: number, status: 'verified' | 'pending' | 'rejected', when: string, ref: string) => {
    const row = await prismaBase.agentDeposit.create({
      data: { tenantId, agentId: kofiId, amount, status, depositDate: new Date(when), depositMethod: 'cash', referenceNumber: `${FIXTURE_SLUG}-${ref}` },
    });
    extraRows.deposits.push(row.id);
  };
  await deposit(40000, 'verified', '2026-10-09T10:00:00Z', 'a');
  await deposit(28600, 'verified', '2026-10-16T10:00:00Z', 'b');
  await deposit(9000, 'pending', '2026-10-10T10:00:00Z', 'c');
  await deposit(7000, 'rejected', '2026-10-10T10:00:00Z', 'd');
  await deposit(5000, 'verified', '2026-09-10T10:00:00Z', 'e');

  jest.useFakeTimers({
    now: FIXTURE_NOW,
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
      'requestIdleCallback', 'cancelIdleCallback', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
});

afterAll(async () => {
  jest.useRealTimers();
  await prismaBase.agentCollection.deleteMany({ where: { id: { in: extraRows.collections } } });
  await prismaBase.agentDeposit.deleteMany({ where: { id: { in: extraRows.deposits } } });
  await prismaBase.systemConfig.updateMany({ where: { tenantId }, data: { rolePermissions: undefined } });
  clearPermissionsCache();
  await deleteFixtureRows(prismaBase, tenantId);
  await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  await prismaBase.$disconnect();
});

describe('delivery on the fixture (F-1053)', () => {
  it('tiles: success 48.3% (376 of 778) against 60; failed 354 and returned 48 as separate numbers; 148 out now with 5 partners', async () => {
    const res = await get(adminToken, 'delivery');
    expect(res.status).toBe(200);
    const { tiles } = res.body;
    expect(tiles.deliverySuccessRate).toMatchObject({ value: 48.3, target: 60, tag: 'off_track', basis: 'cohort', delivered: 376, closed: 778 });
    expect(tiles.failed).toMatchObject({ value: 354, previous: null });
    expect(tiles.returned).toMatchObject({ value: 48, previous: null });
    expect(tiles.outForDeliveryNow).toEqual({ value: 148, partners: 5 });
    expect(JSON.stringify(res.body)).not.toContain('"402"');
  });

  it('reasons: not reachable 165, refused 96, wrong address 84, rescheduled 57 of 402; 41% not reachable', async () => {
    const { reasons, tiles } = (await get(adminToken, 'delivery')).body;
    expect(reasons.total).toBe(402);
    expect(reasons.rows.map((r: any) => [r.reason, r.count])).toEqual([['not_reachable', 165], ['refused', 96], ['wrong_address', 84], ['rescheduled', 57]]);
    expect(reasons.rows[0].percent).toBe(41);
    expect(tiles.notReachable).toEqual({ count: 165, percentOfFailedAndReturned: 41 });
    expect(reasons.total).toBe(tiles.failed.value + tiles.returned.value);
  });

  it('partner table equals kpi.partnerRates row for row; Logiswift 590 assigned, 220 delivered, 270 failed or returned, 100 out; all partners 376 / 402 / 148', async () => {
    const { partners } = (await get(adminToken, 'delivery')).body;
    const kpi = await partnerRates(tenantId, startOfDay('2026-10-01', ZONE), endOfDay('2026-10-17', ZONE));
    expect(partners.rows).toHaveLength(kpi.length);
    for (const k of kpi) {
      const row = partners.rows.find((r: any) => r.partnerId === k.partnerId);
      expect(row).toMatchObject({
        name: k.name, assigned: k.assigned, successRate: k.deliverySuccessRate.value,
        confirmedToDispatchedDays: k.confirmedToDispatchedDays.value, dispatchedToDeliveredDays: k.dispatchedToDeliveredDays.value,
      });
    }
    const logiswift = partners.rows.find((r: any) => r.name.startsWith('Logiswift'));
    expect(logiswift).toMatchObject({ assigned: 590, delivered: 220, failedOrReturned: 270, outNow: 100, cashHeld: '17300.00', paysInDays: null });
    const kasapa = partners.rows.find((r: any) => r.name.startsWith('Kasapa'));
    expect(kasapa).toMatchObject({ delivered: 0, closed: 0, successRate: null, outNow: 8 });
    expect(partners.total).toMatchObject({ assigned: 926, delivered: 376, failedOrReturned: 402, outNow: 148, successRate: 48.3, cashHeld: '23400.00' });
  });

  it('pays in: the median days from collection to approval per partner (Kofi: 3 and 4 days is 3.5); the slowest payer is the tile', async () => {
    const { partners, tiles } = (await get(adminToken, 'delivery')).body;
    expect(partners.rows.find((r: any) => r.partnerId === kofiId).paysInDays).toBe(3.5);
    expect(tiles.slowestPaysIn).toMatchObject({ partnerId: kofiId, days: 3.5 });
  });

  it('success by state: closed orders add up to 778; waiting and returns: 100 waiting, 48 returned; delivered per day adds up to 376', async () => {
    const { successByState, waitingAndReturns, deliveredPerDay } = (await get(adminToken, 'delivery')).body;
    expect(successByState.label).toBe('State');
    expect(successByState.rows.reduce((n: number, r: any) => n + r.closed, 0)).toBe(778);
    expect(successByState.rows.reduce((n: number, r: any) => n + r.delivered, 0)).toBe(376);
    expect(waitingAndReturns.waiting.count).toBe(100);
    expect(waitingAndReturns.waiting.oldestDays).toBeGreaterThanOrEqual(0);
    expect(waitingAndReturns.returned.count).toBe(48);
    expect(deliveredPerDay.rows).toHaveLength(17);
    expect(deliveredPerDay.rows.reduce((n: number, r: any) => n + r.delivered, 0)).toBe(376);
  });

  it('compare=previous: failed and returned carry the previous period from the same rates function', async () => {
    const { tiles, compare } = (await get(adminToken, 'delivery', `${RANGE}&compare=previous`)).body;
    expect(compare).toEqual({ from: '2026-09-01', to: '2026-09-17', days: 17 });
    const prev = await rates(tenantId, startOfDay('2026-09-01', ZONE), endOfDay('2026-09-17', ZONE), { basis: 'cohort' });
    expect(tiles.failed.previous).toBe(prev.deliverySuccessRate.detail!.failed);
    expect(tiles.returned.previous).toBe(prev.deliverySuccessRate.detail!.returned);
    expect(tiles.deliverySuccessRate.previous).toBe(prev.deliverySuccessRate.value);
  });

  it('a block that throws returns { error } without the raw message; the partner table still answers', async () => {
    jest.spyOn(outcomes, 'failureReasons').mockRejectedValue(new Error('select * from orders failed: relation "orders"'));
    const res = await get(adminToken, 'delivery');
    expect(res.status).toBe(200);
    expect(res.body.reasons).toEqual({ error: { code: 'block_failed', errorId: expect.any(String) } });
    expect(JSON.stringify(res.body)).not.toContain('relation');
    expect(res.body.partners.total.delivered).toBe(376);
    expect(res.body.waitingAndReturns.waiting.count).toBe(100);
  });
});

describe('cash tiles with deposits (F-1052)', () => {
  it('cash received counts verified deposits dated in the range only: 68,600.00, 74.6% of delivered revenue', async () => {
    const { tiles } = (await get(adminToken, 'sales', `${RANGE}&compare=previous`)).body;
    expect(tiles.cashReceived).toMatchObject({ value: '68600.00', percentOfDeliveredRevenue: 74.6, previous: '5000.00' });
    expect(tiles.cashWithPartners.value).toBe('23400.00');
  });
});

describe('tab permissions (F-1050)', () => {
  it('Marketing without marketing:view is 403 on the tab and on its export; with it the tab is not built yet (404)', async () => {
    await setManagerPermissions({ marketing: [] });
    expect((await get(managerToken, 'marketing')).status).toBe(403);
    expect((await get(managerToken, 'marketing/export', `${RANGE}&format=csv`)).status).toBe(403);
    expect((await get(accountantToken, 'marketing')).status).toBe(403);
    await setManagerPermissions({});
    expect((await get(managerToken, 'marketing')).status).toBe(404);
    expect((await get(managerToken, 'marketing/export', `${RANGE}&format=csv`)).status).toBe(404);
  });

  it('Products needs financial:view; Team is for owner, admin and manager only', async () => {
    await setManagerPermissions({ financial: [] });
    expect((await get(managerToken, 'products')).status).toBe(403);
    expect((await get(managerToken, 'products/export', `${RANGE}&format=csv`)).status).toBe(403);
    await setManagerPermissions({});
    expect((await get(accountantToken, 'team')).status).toBe(403);
    expect((await get(accountantToken, 'team/export', `${RANGE}&format=csv`)).status).toBe(403);
    expect((await get(managerToken, 'team/export', `${RANGE}&format=csv`)).status).toBe(200);
  });

  it('delivery: 403 for a sales rep, 200 for a manager and the finance clerk', async () => {
    expect((await get(repToken, 'delivery')).status).toBe(403);
    expect((await get(managerToken, 'delivery')).status).toBe(200);
    expect((await get(accountantToken, 'delivery')).status).toBe(200);
  });

  it('export needs analytics:export on top of the tab: a manager without it gets 403, a sales rep and no token are refused', async () => {
    await setManagerPermissions({ analytics: ['view'] });
    expect((await get(managerToken, 'overview')).status).toBe(200);
    expect((await get(managerToken, 'overview/export', `${RANGE}&format=csv`)).status).toBe(403);
    await setManagerPermissions({});
    expect((await get(managerToken, 'overview/export', `${RANGE}&format=csv`)).status).toBe(200);
    expect((await get(repToken, 'overview/export', `${RANGE}&format=csv`)).status).toBe(403);
    expect((await get(null, 'overview/export', `${RANGE}&format=csv`)).status).toBe(401);
  });
});

describe('export files carry the figures of the JSON (F-1057)', () => {
  it('overview CSV: file name, 2 decimals, tiles, "where orders ended up" and the 17 daily rows equal the JSON', async () => {
    const json = (await get(adminToken, 'overview')).body;
    const res = await file(adminToken, 'overview', `${RANGE}&format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain('overview-2026-10-01-2026-10-17.csv');
    const sections = csvSections(res.body as Buffer);
    expect(sections.map((s) => s.title)).toEqual(['Tiles', 'Where orders ended up', 'Daily breakdown']);

    const tiles = Object.fromEntries(section(sections, 'Tiles').rows.map((r) => [r[0], r[1]]));
    expect(Number(tiles['Orders'])).toBe(json.tiles.orders.value);
    expect(Number(tiles['Confirmed'])).toBe(json.tiles.confirmed.value);
    expect(Number(tiles['Delivered'])).toBe(json.tiles.delivered.value);
    expect(tiles['Delivered revenue']).toBe(json.tiles.deliveredRevenue.value); // "92000.00", 2 decimals
    expect(tiles['Delivery success rate %']).toBe(json.tiles.delivered.deliverySuccessRate.value.toFixed(1));

    const ended = section(sections, 'Where orders ended up').rows;
    for (const s of json.endedUp.segments) expect(Number(ended.find((r) => r[0] === s.key)![1])).toBe(s.count);
    expect(Number(ended.find((r) => r[0] === 'Total')![1])).toBe(1445);

    const daily = section(sections, 'Daily breakdown').rows;
    expect(daily).toHaveLength(17 + 1);
    json.daily.rows.forEach((r: any, i: number) => {
      expect(daily[i].slice(0, 5)).toEqual([r.date, String(r.orders), String(r.confirmed), String(r.delivered), r.revenue]);
      expect(daily[i][4]).toMatch(/^-?\d+\.\d{2}$/);
    });
    expect(daily[17].slice(0, 5)).toEqual(['Total', '1445', '1026', '376', '92000.00']);
  });

  it('compare on adds the previous period columns, equal to the JSON', async () => {
    const q = `${RANGE}&compare=previous`;
    const json = (await get(adminToken, 'overview', q)).body;
    const sections = csvSections((await file(adminToken, 'overview', `${q}&format=csv`)).body as Buffer);
    const tiles = section(sections, 'Tiles');
    expect(tiles.header).toEqual(['Metric', 'This period', 'Previous period', 'Change %']);
    const revenue = tiles.rows.find((r) => r[0] === 'Delivered revenue')!;
    expect(revenue.slice(1, 3)).toEqual([json.tiles.deliveredRevenue.value, json.tiles.deliveredRevenue.previous]);
    expect(Number(revenue[3])).toBe(json.tiles.deliveredRevenue.deltaPercent);
    const daily = section(sections, 'Daily breakdown');
    expect(daily.header.slice(5)).toEqual(['Previous date', 'Previous orders', 'Previous confirmed', 'Previous delivered', 'Previous revenue']);
    expect(daily.rows[0].slice(5)).toEqual([
      json.daily.rows[0].previous.date, String(json.daily.rows[0].previous.orders), String(json.daily.rows[0].previous.confirmed),
      String(json.daily.rows[0].previous.delivered), json.daily.rows[0].previous.revenue,
    ]);
  });

  it('sales Excel: numbers are numbers with a 0.00 format, dates are dates, and the figures equal the JSON', async () => {
    const json = (await get(adminToken, 'sales')).body;
    const res = await file(adminToken, 'sales', `${RANGE}&format=xlsx`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toContain('sales-2026-10-01-2026-10-17.xlsx');
    const [sheet] = await xlsxSheets(res.body as Buffer);
    expect(sheet.name).toBe('Sales and revenue');
    const tiles = Object.fromEntries(section(sheet.sections, 'Tiles').rows.map((r) => [r[0], r[1]]));
    expect(tiles['Delivered revenue']).toBe(Number(json.tiles.deliveredRevenue.value));
    expect(tiles['Average order value']).toBe(Number(json.tiles.aov.value));
    expect(tiles['Cash still with partners']).toBe(23400);

    const perDay = section(sheet.sections, 'Delivered revenue per day').rows;
    expect(perDay[0][0]).toBeInstanceOf(Date);
    expect(perDay.reduce((n, r) => n + r[1], 0).toFixed(2)).toBe(json.tiles.deliveredRevenue.value);
    let formatted = false;
    sheet.ws.eachRow((row) => row.eachCell((cell) => { if (cell.numFmt === '0.00') formatted = true; }));
    expect(formatted).toBe(true);

    const state = section(sheet.sections, 'Revenue by state');
    expect(state.header[0]).toBe('State');
    json.byState.rows.forEach((r: any, i: number) => expect(state.rows[i].slice(0, 3)).toEqual([r.state, r.delivered, Number(r.revenue)]));
  });

  it('delivery CSV: the partner table and the reasons equal the JSON', async () => {
    const json = (await get(adminToken, 'delivery')).body;
    const sections = csvSections((await file(adminToken, 'delivery', `${RANGE}&format=csv`)).body as Buffer);
    const tiles = Object.fromEntries(section(sections, 'Tiles').rows.map((r) => [r[0], r[1]]));
    expect(Number(tiles['Failed deliveries'])).toBe(354);
    expect(Number(tiles['Returned'])).toBe(48);
    const partners = section(sections, 'Delivery partners').rows;
    json.partners.rows.forEach((r: any, i: number) => {
      expect(partners[i].slice(0, 5)).toEqual([r.name, String(r.assigned), String(r.delivered), String(r.failedOrReturned), String(r.outNow)]);
      expect(partners[i][5]).toBe(r.successRate === null ? '' : r.successRate.toFixed(1));
      expect(partners[i][8]).toBe(r.cashHeld);
    });
    expect(partners[partners.length - 1].slice(0, 5)).toEqual(['All partners', '926', '376', '402', '148']);
    const reasons = section(sections, 'Failed and returned by reason').rows;
    expect(reasons.slice(0, 4).map((r) => [r[0], Number(r[1])])).toEqual([['not_reachable', 165], ['refused', 96], ['wrong_address', 84], ['rescheduled', 57]]);
  });

  it('team CSV lists the call reps', async () => {
    const sections = csvSections((await file(adminToken, 'team', `${RANGE}&format=csv`)).body as Buffer);
    const reps = section(sections, 'Call reps').rows;
    expect(reps).toHaveLength(3 + 1);
    expect(reps[3][0]).toBe('All call reps');
    expect(reps[3][2]).toBe('1026');
  });

  it('a year-long range streams every daily row (no 500-row cap)', async () => {
    const sections = csvSections((await file(adminToken, 'overview', 'from=2025-10-17&to=2026-10-16&format=csv')).body as Buffer);
    expect(section(sections, 'Daily breakdown').rows).toHaveLength(365 + 1);
  });

  it('"all reports": one workbook with a sheet per tab; the finance clerk gets no Team sheet; no cash rows without financial:view', async () => {
    const res = await file(adminToken, 'all', `${RANGE}&format=xlsx`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('all-reports-2026-10-01-2026-10-17.xlsx');
    const sheets = await xlsxSheets(res.body as Buffer);
    expect(sheets.map((s) => s.name)).toEqual(['Overview', 'Sales and revenue', 'Delivery and operations', 'Team performance']);
    expect(section(sheets[0].sections, 'Tiles').rows.find((r) => r[0] === 'Orders')![1]).toBe(1445);
    expect(section(sheets[3].sections, 'Call reps').rows).toHaveLength(4);

    const clerk = await xlsxSheets((await file(accountantToken, 'all', `${RANGE}&format=xlsx`)).body as Buffer);
    expect(clerk.map((s) => s.name)).toEqual(['Overview', 'Sales and revenue', 'Delivery and operations']);

    await setManagerPermissions({ financial: [] });
    const noCash = await xlsxSheets((await file(managerToken, 'all', `${RANGE}&format=xlsx`)).body as Buffer);
    const labels = section(noCash[1].sections, 'Tiles').rows.map((r) => r[0]);
    expect(labels).toContain('Delivered revenue');
    expect(labels).not.toContain('Cash received');
    await setManagerPermissions({});
  });

  it('there is no PDF: format=pdf is a 400, a /pdf route does not exist, "all" is Excel only, and a bad range is a 400', async () => {
    expect((await get(adminToken, 'overview/export', `${RANGE}&format=pdf`)).status).toBe(400);
    expect((await get(adminToken, 'overview/export', RANGE)).status).toBe(400);
    expect((await get(adminToken, 'all/export', `${RANGE}&format=csv`)).status).toBe(400);
    expect((await get(adminToken, 'overview/pdf')).status).toBe(404);
    expect((await get(adminToken, 'nonsense/export', `${RANGE}&format=csv`)).status).toBe(404);
    expect((await get(adminToken, 'overview/export', 'from=2025-01-01&to=2026-10-17&format=csv')).status).toBe(400);
  });
});

describe('cash held needs financial:view (delivery)', () => {
  it('a manager without it gets no cashHeld in the JSON, the CSV or the workbook; with it the column is there', async () => {
    await setManagerPermissions({ financial: [] });
    const res = await get(managerToken, 'delivery');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('cashHeld');
    expect(JSON.stringify(res.body)).not.toContain('23400');
    expect(res.body.partners.total.delivered).toBe(376);
    const csv = (await file(managerToken, 'delivery', `${RANGE}&format=csv`)).body.toString('utf8');
    expect(csv).not.toContain('Cash held');
    expect(csv).not.toContain('17300');
    const sheets = await xlsxSheets((await file(managerToken, 'all', `${RANGE}&format=xlsx`)).body as Buffer);
    expect(section(sheets[2].sections, 'Delivery partners').header).not.toContain('Cash held');
    await setManagerPermissions({});
    expect((await get(managerToken, 'delivery')).body.partners.total.cashHeld).toBe('23400.00');
    expect((await file(managerToken, 'delivery', `${RANGE}&format=csv`)).body.toString('utf8')).toContain('Cash held');
  });
});

describe('formula injection in exports', () => {
  it('a name that starts with = comes out as text with a leading quote in CSV and Excel; numbers are untouched', async () => {
    const evil = '=HYPERLINK("http://evil.test","x")';
    const product = await prismaBase.product.findFirstOrThrow({ where: { tenantId, sku: 'MG-COPYBOOK-SET' } });
    await prismaBase.product.update({ where: { id: product.id }, data: { name: evil } });
    try {
      const csv = (await file(adminToken, 'sales', `${RANGE}&format=csv`)).body.toString('utf8');
      expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"",""x"")"`);
      expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m);
      const [sheet] = await xlsxSheets((await file(adminToken, 'sales', `${RANGE}&format=xlsx`)).body as Buffer);
      const names = section(sheet.sections, 'Revenue by product').rows.map((r) => r[0]);
      expect(names).toContain(`'${evil}`);
      expect(names).not.toContain(evil);
      const tiles = section(sheet.sections, 'Tiles').rows.find((r) => r[0] === 'Delivered revenue')!;
      expect(tiles[1]).toBe(92000);
    } finally {
      await prismaBase.product.update({ where: { id: product.id }, data: { name: product.name } });
    }
  });
});

describe('response time on the fixture', () => {
  it('logs the time of each endpoint, cold (1 to 17 October, compare on)', async () => {
    const q = `${RANGE}&compare=previous`;
    const timings: string[] = [];
    for (const tab of ['overview', 'sales', 'delivery']) {
      await get(adminToken, tab, q); // warm the pool and the currency cache
      const start = performance.now();
      const res = await get(adminToken, tab, q);
      const ms = Math.round(performance.now() - start);
      expect(res.status).toBe(200);
      timings.push(`${tab} ${ms} ms`);
      expect(ms).toBeLessThan(2000);
    }
    const start = performance.now();
    await file(adminToken, 'all', `${q}&format=xlsx`);
    timings.push(`all-reports xlsx ${Math.round(performance.now() - start)} ms`);
    // eslint-disable-next-line no-console
    console.log(`[reports timing] ${timings.join(', ')}`);
  });
});
