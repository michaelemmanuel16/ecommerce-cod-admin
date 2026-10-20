/**
 * Fixture checks, part 2 (M1-T24, F-114): January to September history, margin history, targets, partner cash and
 * the Meta spend file. `historyFixtureChecks` declares describe/it blocks; numbersFixture.test.ts (which seeds once)
 * calls it.
 */
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import * as Money from '../../../utils/money';
import { prismaBase } from '../../../utils/prisma';
import { deliveredRevenue } from '../../../services/kpi/revenue';
import { endOfDay, getStoreTimeZone, monthRange } from '../../../services/kpi/dates';
import { HISTORY_MONTH_MARGIN, HISTORY_MONTH_REVENUE } from '../../fixtures/numbersFixture';

const zone = getStoreTimeZone();

export function historyFixtureChecks(getTenantId: () => string): void {
  const revenueOf = async (from: Date, to: Date) => (await deliveredRevenue(getTenantId(), from, to)).total.value;
  const month = (m: number) => monthRange(2026, m, zone); // m = 1..12

  describe('fixture part 2: history (M1-T24)', () => {
    it('revenue by delivery month, January to September, equals the list exactly', async () => {
      for (let m = 1; m <= 9; m++) {
        expect([m, await revenueOf(month(m).from, month(m).to)]).toEqual([m, Money.toApi(HISTORY_MONTH_REVENUE[m - 1])]);
      }
      expect(await revenueOf(month(10).from, month(10).to)).toBe('92000.00'); // October is unchanged
    });

    it('quarters are 372k, 421k, 497k and the year to date with October is 1,382,000', async () => {
      expect(await revenueOf(month(1).from, month(3).to)).toBe('372000.00');
      expect(await revenueOf(month(4).from, month(6).to)).toBe('421000.00');
      expect(await revenueOf(month(7).from, month(9).to)).toBe('497000.00');
      expect(await revenueOf(month(1).from, endOfDay('2026-10-17', zone))).toBe('1382000.00'); // about 1.38M
    });

    it('posts the history revenue to the ledger: 4010 credits by entry month equal the list', async () => {
      const rows = await prismaBase.$queryRawUnsafe<Array<{ m: number; revenue: string }>>(
        `SELECT EXTRACT(MONTH FROM j.entry_date)::int AS m, TO_CHAR(SUM(t.credit_amount), 'FM999999990.00') AS revenue
         FROM account_transactions t JOIN accounts a ON a.id = t.account_id JOIN journal_entries j ON j.id = t.journal_entry_id
         WHERE t.tenant_id = $1 AND a.code = '4010' AND j.entry_date < '2026-10-01' GROUP BY 1 ORDER BY 1`, getTenantId());
      expect(rows.map((r) => [r.m, r.revenue])).toEqual(HISTORY_MONTH_REVENUE.map((v, i) => [i + 1, Money.toApi(v)]));
    });

    it('seeded expenses give the margin history: Q1 11%, Q2 12%, Q3 12% (revenue - product cost - expenses)', async () => {
      const tid = getTenantId();
      const rows = await prismaBase.$queryRawUnsafe<Array<{ m: number; cogs: string; expenses: string }>>(
        `SELECT m.m,
                TO_CHAR((SELECT COALESCE(SUM(i.quantity * p.cogs), 0) FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
                         WHERE o.tenant_id = $1 AND o.status = 'delivered' AND EXTRACT(MONTH FROM o.delivery_date) = m.m AND o.delivery_date < '2026-10-01'), 'FM999999990.00') AS cogs,
                TO_CHAR((SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.tenant_id = $1 AND EXTRACT(MONTH FROM e.expense_date) = m.m AND e.expense_date < '2026-10-01'), 'FM999999990.00') AS expenses
         FROM generate_series(1, 9) AS m(m) ORDER BY 1`, tid);
      const margin = rows.map((r, i) => (HISTORY_MONTH_REVENUE[i] - Number(r.cogs) - Number(r.expenses)) / HISTORY_MONTH_REVENUE[i]);
      margin.forEach((value, i) => expect(Math.abs(value - HISTORY_MONTH_MARGIN[i])).toBeLessThan(0.0005));
      const quarter = (q: number) => {
        const idx = [0, 1, 2].map((k) => q * 3 + k);
        const revenue = idx.reduce((s, i) => s + HISTORY_MONTH_REVENUE[i], 0);
        return idx.reduce((s, i) => s + margin[i] * HISTORY_MONTH_REVENUE[i], 0) / revenue;
      };
      expect(Math.round(quarter(0) * 100)).toBe(11);
      expect(Math.round(quarter(1) * 100)).toBe(12);
      expect(Math.round(quarter(2) * 100)).toBe(12);
    });

    it('has the October targets: 180,000 for the month, 540,000 for Q4, 1,800,000 for the year, rates 70 and 60', async () => {
      const targets = await prismaBase.target.findMany({ where: { tenantId: getTenantId() } });
      const pick = (scope: string, metric: string, start: string) =>
        targets.find((t) => t.scope === scope && t.metric === metric && t.periodStart.toISOString().startsWith(start));
      expect(pick('month', 'revenue', '2026-10-01')?.value.toFixed(2)).toBe('180000.00');
      expect(pick('quarter', 'revenue', '2026-10-01')?.value.toFixed(2)).toBe('540000.00');
      expect(pick('north_star', 'revenue', '2026-01-01')?.value.toFixed(2)).toBe('1800000.00');
      expect(pick('north_star', 'confirmation_rate', '2026-01-01')?.value.toFixed(2)).toBe('70.00');
      expect(pick('north_star', 'delivery_success_rate', '2026-01-01')?.value.toFixed(2)).toBe('60.00');
    });

    it('holds GH₵23,400 of cash with the partners, net of fees (AgentBalance)', async () => {
      const rows = await prismaBase.agentBalance.findMany({ where: { tenantId: getTenantId() }, include: { agent: { select: { firstName: true } } } });
      const by = Object.fromEntries(rows.map((r) => [r.agent.firstName, r.currentBalance.toFixed(2)]));
      expect(by).toEqual({ Logiswift: '17300.00', Kofi: '2900.00', Esi: '2100.00', Kwesi: '1100.00', Kasapa: '0.00' });
      expect(rows.reduce((s, r) => s + Number(r.currentBalance), 0)).toBe(23400);
    });

    it('has the Meta spend file: 5 campaigns, NGN 8,530,000, 1,445 orders', () => {
      const file = JSON.parse(fs.readFileSync(path.join(__dirname, '../../fixtures/meta-spend.json'), 'utf8'));
      expect(file.campaigns).toHaveLength(5);
      const sum = (key: string) => file.campaigns.reduce((s: number, c: Record<string, number>) => s + c[key], 0);
      expect(sum('spend')).toBe(8_530_000);
      expect(sum('orders')).toBe(1445);
      for (const key of ['impressions', 'linkClicks', 'landingPageViews', 'checkoutsStarted']) expect(sum(key)).toBe(file.totals[key]);
    });
  });
}
