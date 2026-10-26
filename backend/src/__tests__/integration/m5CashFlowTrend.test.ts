/**
 * M5-T27 (COD-52, F-928, F-929): cash flow without the 1020 double count, forecast on the partner's average days to pay
 * (default 7), supplier payables 2050 at 0 until posted, and the daily trend by delivery date (weekly over 366 days).
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { postEntry } from './helpers/ledgerPost';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { mkCustomer, mkOrder, mkPartner, mkCollection, SettlementWorld } from './helpers/settlementFixtures';

jest.setTimeout(120_000);

let a: string;
let b: string;
let ownerA: { id: number; token: string };
let ownerB: { id: number; token: string };
let worldA: SettlementWorld;
let partner: number;
const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

const cash = (who: { token: string }) => request(app).get('/api/financial/cash-flow').set(auth(who));

beforeAll(async () => {
  a = (await createTenant('Cash A')).id;
  b = (await createTenant('Cash B')).id;
  await Promise.all([seedTenantDefaults(a), seedTenantDefaults(b)]);
  ownerA = await mkUser(a, 'ownerA', 'super_admin');
  ownerB = await mkUser(b, 'ownerB', 'super_admin');
  worldA = { tenantId: a, customerId: await mkCustomer(a, '+233241000011'), actorId: ownerA.id };
  partner = (await mkPartner(a, 'pay', { fees: { delivered: 0 } })).id;

  const id = ownerA.id;
  await postEntry(a, id, '2026-10-01', [['1010', 1000, 0], ['3010', 0, 1000]]);
  await postEntry(a, id, '2026-10-01', [['1015', 500, 0], ['4010', 0, 500]]);
  // Legacy receivable on the retired account (inactive: no posting allowed): it must not count
  await prismaBase.account.updateMany({ where: { tenantId: a, code: '1020' }, data: { currentBalance: 300 } });
  await postEntry(b, ownerB.id, '2026-10-01', [['1010', 77, 0], ['3010', 0, 77]]);
});

afterAll(async () => {
  await deleteTenantRows([a, b]);
  await prismaBase.$disconnect();
});

describe('cash position (F-928)', () => {
  it('1020 is not added to cash now or to the position; expected stays out of cash', async () => {
    const out = await mkOrder(worldA, partner, 'out_for_delivery', { total: 250 });
    expect(out).toBeGreaterThan(0);
    const { kpis } = (await cash(ownerA)).body;
    expect(kpis.cashInHand).toBe('1000.00');
    expect(kpis.cashInTransit).toBe('500.00'); // GL 1015, not an order sum
    expect(kpis.outstandingReceivables).toBeUndefined(); // 1020 is not read at all
    expect(kpis.cashAvailableNow).toBe('1000.00');
    expect(kpis.totalCashPosition).toBe('1500.00');
    expect(kpis.cashExpected).toBe('250.00');
    expect(kpis.totalCashPipeline).toBe('1750.00');
  });

  it('supplier payables show 0 until a shipment has unpaid terms (2050), then flow out on day 1', async () => {
    let res = await cash(ownerA);
    expect(res.body.kpis.supplierPayables).toBe('0.00');
    const day1Before = res.body.forecast[0].expectedExpense;
    await postEntry(a, ownerA.id, '2026-10-02', [['1200', 800, 0], ['2050', 0, 800]]);
    res = await cash(ownerA);
    expect(res.body.kpis.supplierPayables).toBe('800.00');
    expect(Number(res.body.forecast[0].expectedExpense) - Number(day1Before)).toBe(800);
  });

  it('the forecast is not floored at 0', async () => {
    await prismaBase.expense.create({ data: { tenantId: a, category: 'Transport', amount: 90000, description: 'big', expenseDate: new Date(), recordedBy: ownerA.id } });
    const res = await cash(ownerA);
    const last = res.body.forecast[29];
    expect(Number(last.projectedBalance)).toBeLessThan(0); // 90,000 of spend in 30 days is 3,000 a day against 1,500 of cash
    expect(res.body.forecast).toHaveLength(30);
  });
});

describe('days to pay from settlement history', () => {
  it('defaults to 7 days with no history (and tenant B never sees A history later)', async () => {
    const res = await cash(ownerA);
    expect(res.body.payDays).toMatchObject({ default: 7, overall: 7, fromHistory: false });
    const other = await cash(ownerB);
    expect(other.body.payDays.overall).toBe(7);
    expect(other.body.kpis.totalCashPosition).toBe('77.00');
    expect(other.body.kpis.supplierPayables).toBe('0.00');
  });

  it('uses the partner average from settled lines, and lands the held cash on that day', async () => {
    const delivered = await mkOrder(worldA, partner, 'delivered', { total: 100, deliveryDate: new Date('2026-10-01T00:00:00Z') });
    const settlement = await prismaBase.partnerSettlement.create({
      data: { tenantId: a, partnerId: partner, payoutDate: new Date('2026-10-04T00:00:00Z'), payoutAmount: 100, reference: 'S-1', status: 'matched' },
    });
    await prismaBase.partnerSettlementLine.create({ data: { tenantId: a, settlementId: settlement.id, orderId: delivered, externalOrderRef: 'X1', expAmount: 100, matched: true } });
    const heldOrder = await mkOrder(worldA, partner, 'delivered', { total: 500 });
    await mkCollection(a, heldOrder, partner, 500, 'approved', new Date());

    const res = await cash(ownerA);
    expect(res.body.payDays).toMatchObject({ overall: 3, fromHistory: true });
    expect(res.body.payDays.byPartner[String(partner)]).toBe(3);
    const landing = res.body.forecast.findIndex((f: any) => Number(f.expectedCollection) > 0);
    expect(landing + 1).toBe(3); // collection dated today + 3 days
    expect(res.body.forecast[landing].expectedCollection).toBe('500.00');
  });
});

describe('F-929 trend by delivery date', () => {
  const reports = (who: { token: string }, q: string) => request(app).get(`/api/financial/reports?period=daily&${q}`).set(auth(who));

  beforeAll(async () => {
    const mk = (day: string, total: number, extra: Record<string, unknown> = {}) =>
      mkOrder(worldA, partner, 'delivered', { total, deliveryDate: new Date(`${day}T12:00:00Z`), ...extra });
    // Delivered on 5 Oct but last touched much later: the old report used updatedAt
    const late = await mk('2026-03-05', 200);
    await prismaBase.$executeRaw`UPDATE orders SET updated_at = '2026-03-20T12:00:00Z' WHERE id = ${late}`;
    await mk('2026-03-06', 100);
    await prismaBase.expense.create({ data: { tenantId: a, category: 'Transport', amount: 30, description: 'x', expenseDate: new Date('2026-03-05T10:00:00Z'), recordedBy: ownerA.id } });
    await mk('2025-01-10', 50); // far back, for the weekly range
  });

  it('revenue is grouped by delivery date, expenses by expense date', async () => {
    const res = await reports(ownerA, 'startDate=2026-03-01&endDate=2026-03-31');
    expect(res.body.grouping).toBe('day');
    const byDate = Object.fromEntries(res.body.reports.map((r: any) => [r.date, r]));
    expect(byDate['2026-03-05']).toMatchObject({ revenue: '200.00', expenses: '30.00', profit: '170.00', orders: 1 });
    expect(byDate['2026-03-06']).toMatchObject({ revenue: '100.00', expenses: '0.00' });
    expect(byDate['2026-03-20']).toBeUndefined(); // updatedAt is not the basis
    const total = res.body.reports.reduce((t: number, r: any) => t + Number(r.revenue), 0);
    expect(total).toBe(300);
  });

  it('a range over 366 days groups by week (Monday dates the week) and sums to the same total', async () => {
    const res = await reports(ownerA, 'startDate=2025-01-01&endDate=2026-03-31');
    expect(res.body.grouping).toBe('week');
    const keys = res.body.reports.map((r: any) => r.date);
    expect(keys).toContain('2025-01-06'); // 10 Jan 2025 is a Friday: Monday 6 Jan
    expect(keys).toContain('2026-03-02'); // 5 and 6 Mar 2026: Monday 2 Mar
    const week = res.body.reports.find((r: any) => r.date === '2026-03-02');
    expect(week).toMatchObject({ revenue: '300.00', expenses: '30.00', orders: 2 });
    expect(res.body.reports.reduce((t: number, r: any) => t + Number(r.revenue), 0)).toBe(350);
  });

  it('an empty range is an empty list, and tenant B never sees A orders', async () => {
    expect((await reports(ownerA, 'startDate=2019-01-01&endDate=2019-01-31')).body.reports).toEqual([]);
    expect((await reports(ownerB, 'startDate=2025-01-01&endDate=2026-03-31')).body.reports).toEqual([]);
  });
});

describe('F-928 scenario switch, tiles and week by week (M5-T41)', () => {
  let c: string;
  let ownerC: { id: number; token: string };
  const scenario = (q: string) => request(app).get(`/api/financial/cash-flow${q}`).set(auth(ownerC));

  beforeAll(async () => {
    c = (await createTenant('Cash C')).id;
    await seedTenantDefaults(c);
    ownerC = await mkUser(c, 'ownerC', 'super_admin');
    const world: SettlementWorld = { tenantId: c, customerId: await mkCustomer(c, '+233241000031'), actorId: ownerC.id };
    const p = (await mkPartner(c, 'pay', { fees: { delivered: 0 } })).id;
    await postEntry(c, ownerC.id, '2026-10-01', [['1010', 1000, 0], ['3010', 0, 1000]]);
    // Last 30 days: 3 delivered and 7 failed = 30% delivery success; 3,000 collected = 100 a day
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    for (let i = 0; i < 3; i++) {
      const id = await mkOrder(world, p, 'delivered', { total: 1000, deliveryDate: twoDaysAgo });
      await prismaBase.transaction.create({ data: { tenantId: c, orderId: id, type: 'cod_collection', amount: 1000, paymentMethod: 'cod', status: 'collected' } });
    }
    for (let i = 0; i < 7; i++) await mkOrder(world, p, 'failed_delivery', { total: 200 });
  });

  afterAll(async () => {
    await deleteTenantRows([c]);
  });

  it('today\'s pace is the default and reports the delivery success it stands on', async () => {
    const res = await scenario('');
    expect(res.status).toBe(200);
    expect(res.body.scenario).toEqual({ key: 'pace', currentRate: 30, targetRate: 60, multiplier: 1 });
    expect(res.body.forecast[10].expectedCollection).toBe('100.00'); // new deliveries, after the 7 day pay time
    expect((await scenario('?scenario=pace')).body.forecast[10].expectedCollection).toBe('100.00');
  });

  it('the target scenario scales only the inflow of new deliveries; outflows and held cash stay', async () => {
    const pace = (await scenario('?scenario=pace')).body;
    const target = (await scenario('?scenario=target')).body;
    expect(target.scenario).toEqual({ key: 'target', currentRate: 30, targetRate: 60, multiplier: 2 });
    expect(target.forecast[10].expectedCollection).toBe('200.00');
    expect(target.forecast[0].expectedCollection).toBe(pace.forecast[0].expectedCollection); // before the first pay day
    expect(target.forecast.map((d: any) => d.expectedExpense)).toEqual(pace.forecast.map((d: any) => d.expectedExpense));
    expect(Number(target.summary.expectedIn)).toBeGreaterThan(Number(pace.summary.expectedIn));
    expect(target.summary.expectedOut).toBe(pace.summary.expectedOut);
  });

  it('the summary is the sum of the 30 days, and the weeks add up to it', async () => {
    const { summary, weeks, forecast, kpis } = (await scenario('?scenario=pace')).body;
    expect(summary.cashToday).toBe(kpis.cashInHand); // 1010 only: 1015 and expected cash are not in it
    expect(summary.expectedIn).toBe(forecast.reduce((t: number, d: any) => t + Number(d.expectedCollection), 0).toFixed(2));
    expect(summary.endBalance).toBe(forecast[29].projectedBalance);
    expect(summary.endDate).toBe(forecast[29].date);
    expect(weeks).toHaveLength(5); // 7, 7, 7, 7 and 2 days
    expect(weeks[0].from).toBe(forecast[0].date);
    expect(weeks[4].to).toBe(forecast[29].date);
    expect(weeks[4].cashAtEnd).toBe(forecast[29].projectedBalance);
    expect(weeks.reduce((t: number, w: any) => t + Number(w.moneyIn), 0).toFixed(2)).toBe(summary.expectedIn);
    expect(weeks.reduce((t: number, w: any) => t + Number(w.net), 0).toFixed(2)).toBe((Number(summary.expectedIn) - Number(summary.expectedOut)).toFixed(2));
  });

  it('an unknown scenario is a 400', async () => {
    expect((await scenario('?scenario=wild')).status).toBe(400);
    expect((await request(app).get('/api/financial/export/cash-flow?scenario=wild').set(auth(ownerC))).status).toBe(400);
  });

  it('the cash-flow export follows the scenario on screen: same 30 rows, a higher balance at the target', async () => {
    const file = (q: string) => request(app).get(`/api/financial/export/cash-flow?format=csv${q}`).set(auth(ownerC)).buffer(true).parse((res, cb) => {
      let data = ''; res.setEncoding('utf8'); res.on('data', (c) => (data += c)); res.on('end', () => cb(null, data));
    });
    const last = (text: string) => text.trim().split('\n').pop()!.split(',').pop()!.replace(/"/g, '');
    const [pace, target] = [await file(''), await file('&scenario=target')];
    expect(pace.status).toBe(200);
    expect(String(pace.body).trim().split('\n')).toHaveLength(31); // header and 30 days
    expect(Number(last(String(target.body)))).toBeGreaterThan(Number(last(String(pace.body))));
  });
});
