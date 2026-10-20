/**
 * M1-T25 fixture checks (Done when 1, HTTP part), 1 to 17 October 2026. The repointed service functions the HTTP
 * endpoints call (not HTTP itself): analytics dashboard, sales trends, rep and agent performance, product performance,
 * financial summary and order stats. Each reads the KPI layer, so each reports delivered revenue 92,000.00 and 376
 * delivered orders where it reports them. `endpointsFixtureChecks` declares describe/it blocks; kpiContract.test.ts
 * (which seeds once) calls it.
 */
import { describe, it, expect } from '@jest/globals';
import analyticsService from '../../../services/analyticsService';
import financialService from '../../../services/financialService';
import orderService from '../../../services/orderService';
import * as Money from '../../../utils/money';
import { runInTenant } from '../../../utils/tenantContext';

const range = { startDate: '2026-10-01', endDate: '2026-10-17' };

export function endpointsFixtureChecks(getTenantId: () => string): void {
  const inTenant = <T>(fn: () => Promise<T>) => runInTenant(getTenantId(), fn);

  describe('repointed endpoints on the fixture (M1-T25)', () => {
    it('analytics dashboard: revenue 92,000.00, 376 delivered orders, the three named rates', async () => {
      const m = await inTenant(() => analyticsService.getDashboardMetrics(range));
      expect(m.totalRevenue).toBe('92000.00');
      expect(m.deliveredOrders).toBe(376);
      expect(m.totalOrders).toBe(1445);
      expect(m.confirmationRate).toBe(71); // 1,026 / 1,445
      expect(m.deliverySuccessRate).toBe(48.3); // 376 / 778
      expect(m).toHaveProperty('orderToCashYield');
      expect(m).not.toHaveProperty('deliveryRate');
    });

    it('analytics sales trends: the days add up to 92,000.00 and 376 delivered orders', async () => {
      const trends = await inTenant(() => analyticsService.getSalesTrends({ period: 'daily', ...range }));
      expect(Money.toApi(Money.sum(trends.map((t) => t.revenue)))).toBe('92000.00');
      expect(trends.reduce((sum, t) => sum + t.delivered, 0)).toBe(376);
      expect(trends.reduce((sum, t) => sum + t.orders, 0)).toBe(1445);
    });

    it('analytics rep performance: revenue and delivered orders of the reps add up to at most the store total', async () => {
      const reps = await inTenant(() => analyticsService.getRepPerformance(range));
      const revenue = Money.sum(reps.map((r) => r.revenue));
      // 9 orders have no rep, so the reps add up to the store figures or less.
      expect(Money.compare(revenue, '92000.00')).toBeLessThanOrEqual(0);
      expect(reps.reduce((sum, r) => sum + r.completed, 0)).toBeLessThanOrEqual(376);
      expect(reps.every((r) => !('successRate' in r))).toBe(true);
    });

    it('analytics agent performance: delivered orders of the partners add up to 376', async () => {
      const agents = await inTenant(() => analyticsService.getAgentPerformance(range));
      expect(agents.reduce((sum, a) => sum + a.completed, 0)).toBe(376);
      expect(agents.every((a) => !('successRate' in a))).toBe(true);
    });

    it('analytics product performance: units and line revenue from the KPI layer (306 copybook sets = 76,194.00)', async () => {
      const products = await inTenant(() => analyticsService.getProductPerformance(range));
      const bySku = Object.fromEntries(products.map((p) => [p.sku, p]));
      expect(bySku['MG-COPYBOOK-SET']).toMatchObject({ unitsSold: 306, revenue: '76194.00' });
      expect(products.reduce((sum, p) => sum + p.unitsSold, 0)).toBe(635);
      // Line revenue is 92,111.00 (list prices); three orders carry a 37 discount, so delivered revenue is 92,000.00.
      expect(Money.toApi(Money.sum(products.map((p) => p.revenue)))).toBe('92111.00');
    });

    it('financial summary: revenue 92,000.00 from the KPI layer, digital revenue and Paystack fees present', async () => {
      // Noon UTC: the service moves the end bound to the end of that local day.
      const s = await inTenant(() => financialService.getFinancialSummary({
        startDate: new Date('2026-10-01T00:00:00Z'),
        endDate: new Date('2026-10-17T12:00:00Z'),
      }));
      expect(Money.toApi(s.totalRevenue)).toBe('92000.00');
      expect(Money.toApi(s.digitalRevenue)).toBe('0.00');
      expect(Money.toApi(s.paystackFees)).toBe('0.00');
    });

    it('order stats: total revenue 92,000.00 on the delivery-date basis', async () => {
      const stats = await inTenant(() => orderService.getOrderStats({
        startDate: new Date('2026-10-01T00:00:00Z'),
        endDate: new Date('2026-10-17T23:59:59.999Z'),
      }));
      expect(Money.toApi(stats.totalRevenue)).toBe('92000.00');
    });
  });
}
