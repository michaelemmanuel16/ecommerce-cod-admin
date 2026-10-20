/**
 * Fixture checks for the leadership numbers (M1-T19, F-253, F-205) on 17 October 2026.
 * `leadershipFixtureChecks` declares describe/it blocks; numbersFixture.test.ts (which seeds once) calls it.
 */
import { describe, it, expect, beforeAll } from '@jest/globals';
import { leadership, Leadership } from '../../../services/kpi/leadership';

export function leadershipFixtureChecks(getTenantId: () => string): void {
  describe('leadership on the fixture, 17 October 2026 (M1-T19)', () => {
    let l: Leadership;
    beforeAll(async () => {
      l = await leadership(getTenantId(), '2026-10-17');
    });

    it('projects the month at 167.8k, 93% of target (92,000 / 17 x 31)', () => {
      expect(l.revenueSoFar.value).toBe('92000.00');
      expect(l.projectedMonth.value).toBe('167764.71');
      expect(l.projectedPercent.value).toBe(93.2);
    });

    it('needs 6.3k a day for the last 14 days', () => {
      expect(l.neededPerDay.value).toBe('6285.71');
      expect(l.neededPerDay.detail).toEqual({ daysLeft: 14 });
    });

    it('needs 56 orders a day (31 days; the flat 30-day divisor would give 58)', () => {
      expect(l.ordersNeededPerDay.value).toBe(56);
      expect(l.ordersNeededPerDay.detail).toMatchObject({ daysInMonth: 31, confirmationTarget: 70, successTarget: 60 });
      expect(l.ordersNeededPerDay.detail?.exact).toBeGreaterThan(56.3);
      expect(l.ordersNeededPerDay.detail?.exact).toBeLessThan(56.5);
    });

    it('plans on an AOV of 245, the delivered AOV of the last 30 days', () => {
      expect(l.plannedAov.value).toBe('245.00');
      expect(l.plannedAov.source).toBe('auto');
    });

    it('names delivery success as the lever, worth between 21k and 24k', () => {
      expect(l.lever.rate).toBe('deliverySuccessRate');
      expect(Number(l.lever.value)).toBeGreaterThan(21_000);
      expect(Number(l.lever.value)).toBeLessThan(24_000);
    });

    it('has the pace markers: month 54.8, quarter 18.5, year 79.5', () => {
      expect(l.pace.month.value).toBe(54.8);
      expect(l.pace.quarter.value).toBe(18.5);
      expect(l.pace.year.value).toBe(79.5);
    });

    it('has the attainment: month 92k of 180k, quarter 92k of 540k, year 1,382k of 1,800k', () => {
      expect(l.attainment.month).toMatchObject({ actual: '92000.00', target: '180000.00', value: 51.1 });
      expect(l.attainment.quarter).toMatchObject({ actual: '92000.00', target: '540000.00', value: 17 });
      expect(l.attainment.year).toMatchObject({ actual: '1382000.00', target: '1800000.00', value: 76.8 });
    });
  });
}
