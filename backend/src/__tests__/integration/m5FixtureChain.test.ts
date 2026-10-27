/**
 * M5-T46 (COD-55, F-902, F-904, F-906, F-913, F-936): the NUMBERS fixture end to end, on the standard fixture (no private data).
 * Order of the suite matters and is on purpose: the delivered-revenue contract and the margin are read first, then the
 * partner chain delivers Kofi's open orders (dated 18 Oct, after the range, so the October figures stay put).
 *  - Finance, the dashboard, the financial summary and the MCP tool agree on delivered revenue (92,000.00 over 376 orders).
 *  - Rep commission: Adwoa owed 2,034, Nana 134, payable (2020) 2,168; October margin about -16%.
 *  - Kofi's fee (GH25 delivered) is booked once per order; the payout he sends equals collected minus fees; 1020 stays 0.
 * A fixture number that does not match is reported, never edited here.
 */
import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { transitionOrder } from '../../services/orderStateMachine';
import { FinancialSyncService } from '../../services/financialSyncService';
import { postEntry as postCommission } from '../../services/commissionService';
import { recordPartnerPayout, parsePartnerPayout } from '../../services/partnerSettlementService';
import analyticsService from '../../services/analyticsService';
import financialService from '../../services/financialService';
import * as Money from '../../utils/money';
import { seedFixture, deleteFixtureRows, FIXTURE_SLUG } from '../fixtures/numbersFixture';
import { postEntry } from './helpers/ledgerPost';
import { toolData } from './helpers/callTool';
import { mkUser } from './helpers/twoTenants';

jest.setTimeout(300_000);

const RANGE = { startDate: '2026-10-01', endDate: '2026-10-17' };
const REVENUE = '92000.00';
const DELIVERED = 376;
const KOFI_ORDERS = 4;

let tenantId: string;
let owner: { id: number; token: string };
const auth = () => ({ Authorization: `Bearer ${owner.token}` });
const inTenant = <T>(fn: () => Promise<T>) => runInTenant(tenantId, fn);
const balance = async (code: string) =>
  Number((await prismaBase.account.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code } } })).currentBalance);
const userByFirst = (firstName: string) => prismaBase.user.findFirstOrThrow({ where: { tenantId, firstName } });

beforeAll(async () => {
  tenantId = (await seedFixture(prismaBase)).tenantId;
  owner = await mkUser(tenantId, 'ownerT46', 'super_admin');
});

afterAll(async () => {
  // Rows this suite wrote on top of the fixture: they point at the fixture's users, so they go first
  const t = { tenantId };
  await prismaBase.agentDeposit.deleteMany({ where: t });
  await prismaBase.partnerSettlementLine.deleteMany({ where: t });
  await prismaBase.partnerSettlement.deleteMany({ where: t });
  await prismaBase.commissionEntry.deleteMany({ where: t });
  await prismaBase.payout.deleteMany({ where: t });
  await deleteFixtureRows(prismaBase, tenantId);
  await prismaBase.tenant.deleteMany({ where: { slug: FIXTURE_SLUG } });
  await prismaBase.$disconnect();
});

describe('contract: Finance, dashboard, summary and MCP agree on delivered revenue', () => {
  it('all four read 92,000.00 over 376 delivered orders for 1 to 17 October', async () => {
    const overview = await request(app).get('/api/financial/overview?from=2026-10-01&to=2026-10-17&asOf=2026-10-17').set(auth());
    expect(overview.status).toBe(200);
    const tile = overview.body.tiles.find((t: any) => t.key === 'deliveredRevenue');

    const dashboard = await inTenant(() => analyticsService.getDashboardMetrics(RANGE));
    const summary = await inTenant(() => financialService.getFinancialSummary({
      startDate: new Date('2026-10-01T00:00:00Z'),
      endDate: new Date('2026-10-17T12:00:00Z'),
    }));
    const mcp = await toolData('financial_summary', { period: 'custom', dateFrom: '2026-10-01', dateTo: '2026-10-17' }, tenantId);

    const revenues = [tile.value, dashboard.totalRevenue, Money.toApi(summary.totalRevenue), mcp.revenue.delivered];
    expect(revenues).toEqual([REVENUE, REVENUE, REVENUE, REVENUE]);
    const counts = [tile.detail.deliveredOrders, dashboard.deliveredOrders, mcp.revenue.deliveredOrders];
    expect(counts).toEqual([DELIVERED, DELIVERED, DELIVERED]);
  });
});

describe('rep commission and the October margin', () => {
  let adwoa: { id: number };
  let nana: { id: number };

  beforeAll(async () => {
    adwoa = await userByFirst('Adwoa');
    nana = await userByFirst('Nana');
    // Rest of October's plan, funded by the owner (the same lines the Overview suite books): fees, Meta spend, other expenses
    await postEntry(tenantId, owner.id, '2026-10-05', [['5070', 12200, 0], ['3010', 0, 12200]]);
    await postEntry(tenantId, owner.id, '2026-10-03', [['5080', 44700, 0], ['3010', 0, 44700]]);
    for (let day = 10; day <= 16; day++) await postEntry(tenantId, owner.id, `2026-10-${day}`, [['5080', 4500, 0], ['3010', 0, 4500]]);
    await postEntry(tenantId, owner.id, '2026-10-08', [['5100', 2703, 0], ['3010', 0, 2703]]);

    // Commission and upsell reward entries: Adwoa 2,024 + 610 (600 of it paid on 9 Oct), Nana 104 + 30. Each posts DR 5050 / CR 2020.
    const entry = async (userId: number, kind: 'base' | 'upsell', amount: number, day: number, extra: Record<string, unknown> = {}) => {
      const row = await prismaBase.commissionEntry.create({
        data: { tenantId, userId, kind, status: 'earned', amount, earnedAt: new Date(Date.UTC(2026, 9, day, 10)), ...extra } as any,
      });
      await inTenant(() => prisma.$transaction((tx) => postCommission(tx, row.id, owner.id)));
      return row.id;
    };
    const paidPayout = await prismaBase.payout.create({ data: { tenantId, payeeId: adwoa.id, kind: 'rep', amount: 600, method: 'Bank Transfer', status: 'completed' } });
    const paidEntry = await entry(adwoa.id, 'base', 600, 1);
    await prismaBase.commissionEntry.update({ where: { id: paidEntry }, data: { status: 'paid', payoutId: paidPayout.id } });
    await postEntry(tenantId, owner.id, '2026-10-09', [['2020', 600, 0], ['1010', 0, 600]]); // the 600 leaves 2020
    await entry(adwoa.id, 'base', 1424, 2);
    await entry(adwoa.id, 'upsell', 610, 3);
    await entry(nana.id, 'base', 104, 4);
    await entry(nana.id, 'upsell', 30, 5);
  });

  it('Adwoa is owed 2,034 and Nana 134, and 2020 holds the payable 2,168', async () => {
    const a = await request(app).get(`/api/payouts/owed/${adwoa.id}`).set(auth());
    expect(a.body).toMatchObject({ commission: '2024.00', upsellReward: '610.00', earned: '2634.00', paid: '600.00', owed: '2034.00' });
    const n = await request(app).get(`/api/payouts/owed/${nana.id}`).set(auth());
    expect(n.body).toMatchObject({ commission: '104.00', upsellReward: '30.00', owed: '134.00' });
    expect(Number(a.body.owed) + Number(n.body.owed)).toBe(2168);
    expect(await balance('2020')).toBe(2168);
  });

  it('the October margin is about -16%, read by Finance and by the income statement', async () => {
    const overview = await request(app).get('/api/financial/overview?from=2026-10-01&to=2026-10-17&asOf=2026-10-17').set(auth());
    const margin = overview.body.tiles.find((t: any) => t.key === 'netMargin');
    expect(margin.value).toBeCloseTo(-15.5, 1);
    expect(-Math.round(-margin.value)).toBe(-16);

    const pl = await request(app).get('/api/financial/profit-loss?startDate=2026-10-01&endDate=2026-10-17').set(auth());
    expect(pl.body.statement.revenue).toBe(REVENUE);
    expect(pl.body.statement.repCommission).toBe('2768.00');
    expect(pl.body.statement.netProfit).toBe(margin.detail.netProfit);
    const pct = (Number(pl.body.statement.netProfit) / Number(pl.body.statement.revenue)) * 100;
    expect(Math.round(pct)).toBe(-16);
  });
});

describe("Kofi's fee, settlement and the cash chain", () => {
  let kofiId: number;
  let orderIds: number[] = [];
  const feeEntries = (orderId: number) => prismaBase.journalEntry.findMany({ where: { tenantId, sourceType: 'delivery_fee', sourceId: orderId } });

  beforeAll(async () => {
    kofiId = (await userByFirst('Kofi')).id;
    await prismaBase.feeRule.create({ data: { tenantId, partnerUserId: kofiId, outcome: 'delivered', amount: 25, validFrom: new Date('2026-01-01') } });
    const open = await prismaBase.order.findMany({ where: { tenantId, deliveryAgentId: kofiId, status: 'out_for_delivery' }, orderBy: { id: 'asc' }, take: KOFI_ORDERS });
    expect(open).toHaveLength(KOFI_ORDERS); // the fixture gives Kofi 20 orders out for delivery
    orderIds = open.map((o) => o.id);
  });

  it('GH25 is booked once per delivered order, and a repeat of the move books nothing', async () => {
    const before = await balance('5070');
    const actor = { kind: 'user' as const, userId: owner.id, role: 'super_admin' as const };
    for (const id of orderIds) {
      await inTenant(() => transitionOrder(id, 'delivered', actor, { deliveryDate: new Date('2026-10-18T12:00:00.000Z') }));
    }
    expect(await balance('5070')).toBe(before + 25 * KOFI_ORDERS);
    for (const id of orderIds) {
      expect(await feeEntries(id)).toHaveLength(1);
      expect(Number((await prismaBase.order.findUniqueOrThrow({ where: { id } })).deliveryFee)).toBe(25);
      await inTenant(() => transitionOrder(id, 'delivered', actor, { deliveryDate: new Date('2026-10-18T12:00:00.000Z') }));
      expect(await feeEntries(id)).toHaveLength(1);
    }
    expect(await balance('5070')).toBe(before + 25 * KOFI_ORDERS);
  });

  it('expected payout = collected minus fees: a payout of exactly that is matched, posts one deposit, and a replay changes nothing', async () => {
    await inTenant(() => FinancialSyncService.batchSyncOrders(orderIds, owner.id));
    const orders = await prismaBase.order.findMany({ where: { id: { in: orderIds } } });
    const collected = orders.reduce((s, o) => s + Number(o.totalAmount), 0);
    const expectedPayout = collected - 25 * KOFI_ORDERS;
    const collections = await prismaBase.agentCollection.findMany({ where: { orderId: { in: orderIds } } });
    expect(collections.reduce((s, c) => s + Number(c.amount), 0)).toBeCloseTo(expectedPayout, 2); // each collection is net of the fee

    const cashBefore = await balance('1015');
    const call = () => inTenant(() => recordPartnerPayout({ id: owner.id }, parsePartnerPayout({
      partnerId: kofiId, payoutDate: '2026-10-20', payoutAmount: expectedPayout, reference: 'T46-KOFI',
      lines: orders.map((o) => ({ externalOrderRef: `#${o.id}`, orderId: o.id, expAmount: Number(o.totalAmount), charge: 25 })),
    })));
    const first = await call();
    expect(first).toMatchObject({ status: 'matched', matchedLines: KOFI_ORDERS, unmatchedLines: 0, replayed: false });
    expect(Number(first.expectedNet)).toBeCloseTo(expectedPayout, 2);
    expect(Number(first.payoutAmount)).toBeCloseTo(expectedPayout, 2);
    expect(Number(first.shortAmount)).toBe(0);
    const after = await balance('1015');
    expect(cashBefore - after).toBeCloseTo(expectedPayout, 2);
    expect(await prismaBase.agentDeposit.count({ where: { tenantId, settlementId: first.id } })).toBe(1);

    const again = await call();
    expect(again.replayed).toBe(true);
    expect(again.id).toBe(first.id);
    expect(await balance('1015')).toBe(after);
    expect(await prismaBase.agentDeposit.count({ where: { tenantId, settlementId: first.id } })).toBe(1);
    for (const id of orderIds) expect(await feeEntries(id)).toHaveLength(1); // the true-up books no second fee
  });

  it('account 1020 is 0 and has no lines, and every journal entry balances', async () => {
    expect(await balance('1020')).toBe(0);
    expect(await prismaBase.accountTransaction.count({ where: { tenantId, account: { code: '1020' } } })).toBe(0);
    const unbalanced = await prismaBase.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*) AS n FROM (SELECT journal_entry_id FROM account_transactions WHERE tenant_id = $1 GROUP BY 1
        HAVING SUM(debit_amount) <> SUM(credit_amount)) x`, tenantId);
    expect(Number(unbalanced[0].n)).toBe(0);
  });
});
