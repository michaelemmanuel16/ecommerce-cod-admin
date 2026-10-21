/**
 * Fixture checks for the MCP tools (M1-T26, "Done when" 1, MCP part): delivered revenue 92,000.00 and 376 delivered
 * orders for 1 to 17 October 2026. `mcpFixtureChecks` declares describe/it blocks; kpiContract.test.ts (which
 * seeds once) calls it.
 *
 * Which tool takes which window:
 *  - orders_summary and financial_summary take period 'custom' with dateFrom/dateTo (inclusive): asserted on exactly 1 to 17 October.
 *  - analytics_daily takes one day: the 17 days are called and summed.
 *  - analytics_weekly takes a Monday-to-Sunday week and analytics_monthly a calendar month, so neither can be exactly
 *    1 to 17 October (1 October 2026 is a Thursday; the week of 28 September also holds September history deliveries).
 *    Weekly: days 1 to 4 (daily) + the weeks of 5 and 12 October (12 to 18). Monthly: October 2026 whole.
 *    Both rely on the fixture having no delivery after 17 October (the fixture's last day is the 17th).
 */
import { describe, it, expect } from '@jest/globals';
import * as Money from '../../../utils/money';
import '../../../tools';
import { toolData } from '../helpers/callTool';
import { shiftYmd } from '../../../services/kpi/dates';

const FROM = '2026-10-01';
const TO = '2026-10-17';
const REVENUE = '92000.00';
const DELIVERED = 376;
const BANNED_KEYS = /^(deliveryRate|fulfilmentRate|fulfillmentRate|conversionRate)$/;

function collectKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => collectKeys(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.push(k); collectKeys(v, out); }
  }
  return out;
}

export function mcpFixtureChecks(getTenantId: () => string): void {
  const call = (name: string, args: Record<string, unknown>) => toolData(name, args, getTenantId());

  describe('MCP tools on the fixture (M1-T26)', () => {
    it('orders_summary for 1 to 17 October: revenue 92000.00, 376 delivered, three rate names only', async () => {
      const body = await call('orders_summary', { period: 'custom', dateFrom: FROM, dateTo: TO });
      expect(body.revenue).toBe(REVENUE);
      expect(body.deliveredCount).toBe(DELIVERED);
      expect(body).toHaveProperty('confirmationRate');
      expect(body).toHaveProperty('deliverySuccessRate');
      expect(body).toHaveProperty('orderToCashYield');
      expect(collectKeys(body).filter((k) => BANNED_KEYS.test(k))).toEqual([]);
    });

    it('financial_summary for 1 to 17 October: delivered revenue 92000.00 and 376 delivered orders', async () => {
      const body = await call('financial_summary', { period: 'custom', dateFrom: FROM, dateTo: TO });
      expect(body.revenue.delivered).toBe(REVENUE);
      expect(body.revenue.deliveredOrders).toBe(DELIVERED);
    });

    it('analytics_daily summed over 1 to 17 October is 92000.00 and 376', async () => {
      let revenue = Money.ZERO;
      let delivered = 0;
      for (let d = FROM; d <= TO; d = shiftYmd(d, 1)) {
        const body = await call('analytics_daily', { date: d });
        expect(body.revenue).toMatch(/^-?\d+\.\d{2}$/);
        expect(collectKeys(body).filter((k) => BANNED_KEYS.test(k))).toEqual([]);
        revenue = Money.add(revenue, body.revenue);
        delivered += body.delivered;
      }
      expect(Money.toApi(revenue)).toBe(REVENUE);
      expect(delivered).toBe(DELIVERED);
    });

    it('analytics_weekly: 1 to 4 October (daily) + the weeks of 5 and 12 October is 92000.00 and 376', async () => {
      let revenue = Money.ZERO;
      let delivered = 0;
      for (let d = FROM; d <= '2026-10-04'; d = shiftYmd(d, 1)) {
        const body = await call('analytics_daily', { date: d });
        revenue = Money.add(revenue, body.revenue);
        delivered += body.delivered;
      }
      for (const weekOf of ['2026-10-05', '2026-10-12']) {
        const body = await call('analytics_weekly', { weekOf });
        expect(body.currentWeek.from).toBe(weekOf);
        expect(collectKeys(body).filter((k) => BANNED_KEYS.test(k))).toEqual([]);
        revenue = Money.add(revenue, body.currentWeek.revenue);
        delivered += body.currentWeek.delivered;
      }
      expect(Money.toApi(revenue)).toBe(REVENUE);
      expect(delivered).toBe(DELIVERED);
    });

    it('analytics_monthly for October 2026 is 92000.00 and 376 (nothing is delivered after the 17th)', async () => {
      const body = await call('analytics_monthly', { month: '2026-10' });
      expect(body.revenue).toBe(REVENUE);
      expect(body.delivered).toBe(DELIVERED);
      expect(collectKeys(body).filter((k) => BANNED_KEYS.test(k))).toEqual([]);
    });
  });
}
