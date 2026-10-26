/**
 * M5-T24 (COD-52, F-902, F-907, F-910, F-927): GET /api/financial/overview on the NUMBERS fixture.
 * The fixture holds the orders and the revenue entries. This suite books the rest of October's plan on top of it (delivery fees,
 * Meta spend, rep commission, other expenses, and an owner's-equity entry that sets the cash to GH₵41.9k), so the tiles read
 * the PRD numbers: revenue 92,000 over 376 orders (AOV 245), margin -15.5% (shown -16%), runway 9 days.
 * A second tenant holds a paid digital order (4020 and the Paystack fee on 5060) and proves nothing crosses tenants.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import * as kpiRevenue from '../../services/kpi/revenue';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';
import { postEntry } from './helpers/ledgerPost';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { mkCustomer, mkOrder, SettlementWorld } from './helpers/settlementFixtures';

jest.setTimeout(300_000);

const RANGE = 'from=2026-10-01&to=2026-10-17&asOf=2026-10-17';
let a: string;
let b: string;
let owner: { id: number; token: string };
let ownerB: { id: number; token: string };
let agent: { id: number; token: string };
let partnerIds: Record<string, number>;
const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });
const overview = (who: { token: string }, q = RANGE) => request(app).get(`/api/financial/overview?${q}`).set(auth(who));
const tileOf = (body: any, key: string) => body.tiles.find((t: any) => t.key === key);

beforeAll(async () => {
  a = (await seedFixture(prismaBase)).tenantId;
  b = (await createTenant('Overview B')).id;
  await seedTenantDefaults(b);
  [owner, agent, ownerB] = await Promise.all([mkUser(a, 'ownerA', 'super_admin'), mkUser(a, 'agentA', 'delivery_agent'), mkUser(b, 'ownerB', 'super_admin')]);

  // Rest of October's plan, funded by the owner so cash stays under the next entry's control
  await postEntry(a, owner.id, '2026-10-05', [['5070', 12200, 0], ['3010', 0, 12200]]);
  await postEntry(a, owner.id, '2026-10-03', [['5080', 44700, 0], ['3010', 0, 44700]]);
  for (let day = 10; day <= 16; day++) await postEntry(a, owner.id, `2026-10-${day}`, [['5080', 4500, 0], ['3010', 0, 4500]]); // 7 full days at 4,500
  await postEntry(a, owner.id, '2026-10-07', [['5050', 2768, 0], ['3010', 0, 2768]]);
  await postEntry(a, owner.id, '2026-10-08', [['5100', 2703, 0], ['3010', 0, 2703]]);
  // Cash 41,900 in all: the fixture's 1015 holds every delivery of the year, so take the rest out against owner's equity
  await postEntry(a, owner.id, '2026-10-17', [['3010', 1340100, 0], ['1015', 0, 1340100]]);

  // Partners and payouts of the sample: Kofi and Logiswift paid, Logiswift 840 short, Esi 100 over
  partnerIds = {};
  for (const first of ['Logiswift', 'Kofi', 'Esi']) {
    partnerIds[first] = (await prismaBase.user.findFirstOrThrow({ where: { tenantId: a, firstName: first } })).id;
  }
  await prismaBase.user.update({ where: { id: partnerIds.Logiswift }, data: { kind: 'company' } });
  const settle = (partner: string, date: string, paid: number, expected: number, status: 'matched' | 'short' | 'over', reference: string) =>
    prismaBase.partnerSettlement.create({
      data: {
        tenantId: a, partnerId: partnerIds[partner], payoutDate: new Date(`${date}T00:00:00.000Z`), payoutAmount: paid, expectedNet: expected,
        shortAmount: Math.max(expected - paid, 0), status, reference,
        lines: { create: Array.from({ length: 2 }, (_, i) => ({ tenantId: a, externalOrderRef: `${reference}-${i}`, expAmount: expected / 2, matched: true })) },
      },
    });
  await settle('Logiswift', '2026-10-11', 9880, 10720, 'short', 'LS-11OCT');
  await settle('Kofi', '2026-10-09', 3136, 3136, 'matched', 'KA-9OCT');
  await settle('Esi', '2026-10-08', 2788, 2688, 'over', 'EB-8OCT');
  await settle('Kofi', '2026-09-30', 500, 500, 'matched', 'KA-30SEP'); // outside the range
  const deposit = (partner: string, amount: number, date: string, status: 'verified' | 'pending', ref: string) =>
    prismaBase.agentDeposit.create({ data: { tenantId: a, agentId: partnerIds[partner], amount, status, depositDate: new Date(`${date}T00:00:00.000Z`), depositMethod: 'momo', referenceNumber: ref } });
  await deposit('Kofi', 3136, '2026-10-09', 'verified', 'OV-1');
  await deposit('Logiswift', 9880, '2026-10-11', 'verified', 'OV-2');
  await deposit('Esi', 777, '2026-10-12', 'pending', 'OV-3'); // not verified: not cash received
  await deposit('Kofi', 400, '2026-10-20', 'verified', 'OV-4'); // after the range

  // Tenant B: a paid digital order of GH₵59 (4020) with a Paystack fee of 1.50 (5060) and a payout of its own
  const worldB: SettlementWorld = { tenantId: b, customerId: await mkCustomer(b, '+233241000009'), actorId: ownerB.id };
  await mkOrder(worldB, null, 'digital_delivered', { total: 59, paymentStatus: 'paid', deliveryDate: new Date('2026-10-12T10:00:00.000Z'), orderType: 'digital' });
  await postEntry(b, ownerB.id, '2026-10-12', [['1030', 57.5, 0], ['5060', 1.5, 0], ['4020', 0, 59]]);
  const bPartner = await mkUser(b, 'partnerB', 'delivery_agent');
  await prismaBase.partnerSettlement.create({
    data: { tenantId: b, partnerId: bPartner.id, payoutDate: new Date('2026-10-12T00:00:00.000Z'), payoutAmount: 10, expectedNet: 10, status: 'matched', reference: 'B-ONLY-REF' },
  });
});

afterEach(() => { jest.restoreAllMocks(); });

afterAll(async () => {
  await prismaBase.partnerSettlement.deleteMany({ where: { tenantId: { in: [a, b] } } });
  await prismaBase.agentDeposit.deleteMany({ where: { tenantId: a } });
  await deleteTenantRows([b]);
  await deleteFixtureRows(prismaBase, a);
  await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  await prismaBase.$disconnect();
});

describe('GET /api/financial/overview on the NUMBERS fixture', () => {
  it('returns six tiles in one call, in order', async () => {
    const res = await overview(owner);
    expect(res.status).toBe(200);
    expect(res.body.tiles.map((t: any) => t.key)).toEqual(['deliveredRevenue', 'cashReceived', 'cashOutstanding', 'netMargin', 'profitPerOrder', 'cashRunway']);
    expect(res.body.tiles.every((t: any) => t.status === 'ok')).toBe(true);
    expect(res.body.from).toBe('2026-10-01');
    expect(res.body.to).toBe('2026-10-17');
  });

  it('delivered revenue is 92,000 over 376 orders, AOV 245, with the digital line', async () => {
    const t = tileOf((await overview(owner)).body, 'deliveredRevenue');
    expect(t.value).toBe('92000.00');
    expect(t.detail.deliveredOrders).toBe(376);
    expect(t.detail.averageOrderValue).toBe('244.68');
    expect(Math.round(Number(t.detail.averageOrderValue))).toBe(245);
    expect(t.detail.ofWhichDigital).toBe('0.00');
  });

  it('net margin is about -16% with the expense lines, and profit per delivered order about -38', async () => {
    const body = (await overview(owner)).body;
    const margin = tileOf(body, 'netMargin');
    expect(margin.detail.netProfit).toBe('-14268.00');
    expect(margin.value).toBe(-15.5); // shown as -16%
    expect(-Math.round(-margin.value)).toBe(-16); // half away from zero, as the page rounds
    expect(margin.tone).toBe('bad');
    expect(margin.detail.target).toBe(35);
    expect(margin.detail.expenses).toMatchObject({ deliveryFees: '12200.00', metaSpend: '76200.00', repCommission: '2768.00', paystackFees: '0.00', other: '2703.00' });
    const per = tileOf(body, 'profitPerOrder');
    expect(per.value).toBe('-37.95');
    expect(Math.round(Number(per.value))).toBe(-38);
  });

  it('cash runway is 9 days: GH₵41.9k over GH₵4,500 a day of ads, from the last seven days', async () => {
    const body = (await overview(owner)).body;
    expect(body.runway).toMatchObject({ days: 9, cash: '41900.00', adsPerDay: '4500.00', adDays: 7, level: 'tight', tone: 'warn' });
    const t = tileOf(body, 'cashRunway');
    expect(t.value).toBe(9);
    expect(t.detail).toMatchObject({ cash: '41900.00', adsPerDay: '4500.00' });
    expect(t.dateBasis).toBe('today');
  });

  it('cash received counts verified payouts inside the range only', async () => {
    const t = tileOf((await overview(owner)).body, 'cashReceived');
    expect(t.value).toBe('13016.00'); // 3,136 + 9,880. Not the pending 777, not the one on 20 Oct
    expect(t.detail.payouts).toBe(2);
    expect(t.detail.percentOfDeliveredRevenue).toBe(14);
  });

  it('cash outstanding and unpaid by age come from the aging service and agree', async () => {
    const body = (await overview(owner)).body;
    const out = tileOf(body, 'cashOutstanding');
    expect(out.value).toBe(body.unpaidByAge.total.amount);
    expect(out.detail.orders).toBe(body.unpaidByAge.total.orders);
    expect(out.detail.overdueOrders).toBe(body.unpaidByAge.overdue.orders);
    expect(body.unpaidByAge.buckets.map((x: any) => x.key)).toEqual(['0-3', '4-7', '8-14', '15+']);
    expect(body.unpaidByAge.basis).toBe('net_of_delivery_fee');
    expect(out.dateBasis).toBe('today');
  });

  it('payout reconciliation lists Matched, Short and Over; a Short row carries the partner\'s unpaid orders', async () => {
    const rec = (await overview(owner)).body.reconciliation;
    expect(rec.counts).toEqual({ matched: 1, short: 1, over: 1, unmatched: 0 });
    expect(rec.rows.map((r: any) => r.reference)).toEqual(['LS-11OCT', 'KA-9OCT', 'EB-8OCT']); // newest first; 30 Sep is out
    const short = rec.rows[0];
    expect(short).toMatchObject({ partnerName: 'Logiswift 3PL', partnerKind: 'company', paidIn: '9880.00', expectedAfterFees: '10720.00', status: 'short', shortAmount: '840.00', orders: 2 });
    expect(short.unpaid.orders).toBeGreaterThan(0);
    expect(short.unpaid.rows.length).toBeLessThanOrEqual(10);
    expect(short.unpaid.rows[0]).toEqual(expect.objectContaining({ orderNumber: expect.stringMatching(/^#\d+$/), amount: expect.stringMatching(/^\d+\.\d{2}$/), ageDays: expect.any(Number) }));
    const ages = short.unpaid.rows.map((r: any) => r.ageDays);
    expect(ages).toEqual([...ages].sort((x: number, y: number) => y - x)); // oldest first
    expect(rec.rows[1]).toMatchObject({ status: 'matched', unpaid: null });
    expect(rec.rows[2]).toMatchObject({ status: 'over', overAmount: '100.00', unpaid: null });
  });

  it('every tile carries a tooltip with its date basis, and no tile shows 26% or a delivery rate', async () => {
    const res = await overview(owner);
    const text = JSON.stringify(res.body);
    expect(res.body.tiles.every((t: any) => typeof t.tooltip === 'string' && t.tooltip.length > 20)).toBe(true);
    expect(tileOf(res.body, 'deliveredRevenue').tooltip).toContain('1 Oct to 17 Oct');
    expect(tileOf(res.body, 'cashOutstanding').tooltip).toContain('as of today');
    expect(text).not.toMatch(/26%|delivery rate/i);
    expect(text).not.toMatch(/NaN|Infinity/);
  });

  it('a range with no delivered orders gives n/a, never NaN', async () => {
    const res = await overview(owner, 'from=2026-12-01&to=2026-12-31&asOf=2026-12-31');
    expect(res.status).toBe(200);
    expect(tileOf(res.body, 'deliveredRevenue').value).toBe('0.00');
    expect(tileOf(res.body, 'deliveredRevenue').detail.averageOrderValue).toBe('n/a');
    for (const key of ['netMargin', 'profitPerOrder']) {
      const t = tileOf(res.body, key);
      expect(t.value).toBe('n/a');
      expect(t.available).toBe(false);
    }
    expect(res.body.reconciliation.rows).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/NaN|Infinity|null.*undefined/);
  });

  it('no Meta spend in the last seven days gives n/a runway, not Infinity', async () => {
    const res = await overview(owner, 'from=2026-10-01&to=2026-10-17&asOf=2026-11-30');
    expect(res.body.runway.days).toBeNull();
    expect(res.body.runway.level).toBe('no_ads');
    expect(tileOf(res.body, 'cashRunway').value).toBe('n/a');
  });

  it('with no dates it reads the current month to date', async () => {
    const res = await overview(owner, 'asOf=2026-10-17');
    expect(res.body.from).toBe('2026-10-01');
    expect(res.body.to).toBe('2026-10-17');
    expect(tileOf(res.body, 'deliveredRevenue').value).toBe('92000.00');
  });
});

describe('a failing tile does not fail the call', () => {
  it('revenue failing gives error tiles for the tiles that read it, and the others load', async () => {
    jest.spyOn(kpiRevenue, 'deliveredRevenue').mockRejectedValue(new Error('boom'));
    const res = await overview(owner);
    expect(res.status).toBe(200);
    expect(tileOf(res.body, 'deliveredRevenue')).toMatchObject({ status: 'error', label: 'Delivered revenue' });
    expect(tileOf(res.body, 'cashReceived').status).toBe('error'); // needs revenue for its percent
    expect(tileOf(res.body, 'profitPerOrder').status).toBe('error');
    expect(tileOf(res.body, 'netMargin').status).toBe('ok');
    expect(tileOf(res.body, 'cashOutstanding').status).toBe('ok');
    expect(tileOf(res.body, 'cashRunway').status).toBe('ok');
    expect(res.body.reconciliation.rows).toHaveLength(3);
    expect(res.body.unpaidByAge.total).toBeDefined();
    expect(JSON.stringify(res.body)).not.toContain('boom'); // the message does not leak the cause
  });
});

describe('digital revenue and the Paystack fee (tenant B)', () => {
  it('the revenue tile shows the digital order, the margin tile the 5060 fee', async () => {
    const body = (await overview(ownerB, 'from=2026-10-01&to=2026-10-31&asOf=2026-10-31')).body;
    const rev = tileOf(body, 'deliveredRevenue');
    expect(rev.value).toBe('59.00');
    expect(rev.detail.ofWhichDigital).toBe('59.00');
    expect(rev.detail.deliveredOrders).toBe(1);
    const margin = tileOf(body, 'netMargin');
    expect(margin.detail.expenses.paystackFees).toBe('1.50');
    expect(margin.detail.netProfit).toBe('57.50');
    expect(margin.value).toBe(97.5);
  });
});

describe('tenants and permissions', () => {
  it('tenant B sees only its own numbers, and tenant A never sees B', async () => {
    const mine = JSON.stringify((await overview(owner)).body);
    expect(mine).not.toContain('B-ONLY-REF');
    const theirs = (await overview(ownerB, 'from=2026-10-01&to=2026-10-31&asOf=2026-10-31')).body;
    expect(theirs.reconciliation.rows.map((r: any) => r.reference)).toEqual(['B-ONLY-REF']);
    expect(tileOf(theirs, 'deliveredRevenue').value).toBe('59.00');
    expect(theirs.unpaidByAge.total.orders).toBe(0);
    expect(tileOf(theirs, 'cashReceived').value).toBe('0.00');
    expect(JSON.stringify(theirs)).not.toContain('LS-11OCT');
  });

  it('needs financial view: a delivery agent gets 403', async () => {
    expect((await overview(agent)).status).toBe(403);
    expect((await request(app).get('/api/financial/overview')).status).toBe(401);
  });

  it('rejects a bad or reversed date with 400', async () => {
    expect((await overview(owner, 'from=17-10-2026&to=2026-10-17')).status).toBe(400);
    expect((await overview(owner, 'from=2026-10-17&to=2026-10-01')).status).toBe(400);
    expect((await overview(owner, 'from=2026-02-30&to=2026-03-01')).status).toBe(400);
    expect((await overview(owner, 'asOf=yesterday')).status).toBe(400);
  });
});
