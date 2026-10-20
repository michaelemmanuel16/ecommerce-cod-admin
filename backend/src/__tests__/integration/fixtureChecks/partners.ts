/**
 * M1-T21 fixture checks: partner rows of docs/mockups/v2/NUMBERS.md, 1 to 17 October 2026.
 * Called from numbersFixture.test.ts, which seeds once. Declares describe/it blocks only.
 */
import { describe, it, expect } from '@jest/globals';
import { partnerRates, PartnerRow } from '../../../services/kpi/partners';
import { getStoreTimeZone, startOfDay, endOfDay } from '../../../services/kpi/dates';

export function partnersFixtureChecks(getTenantId: () => string): void {
  describe('partner rates (M1-T21, F-702)', () => {
    let rows: PartnerRow[];
    const row = (name: string) => rows.find((r) => r.name.startsWith(name))!;

    it('reads the five partners for 1 to 17 October', async () => {
      const zone = getStoreTimeZone(getTenantId());
      rows = await partnerRates(getTenantId(), startOfDay('2026-10-01', zone), endOfDay('2026-10-17', zone));
      expect(rows.map((r) => r.name.split(' ')[0]).sort()).toEqual(['Kasapa', 'Kofi', 'Esi', 'Kwesi', 'Logiswift'].sort());
    });

    it('closed-order success: Logiswift 45%, Kofi 54%, Esi 55%, Kwesi 54%, Kasapa has no closed orders', () => {
      const pct = (name: string) => Math.round(row(name).deliverySuccessRate.value!);
      expect(pct('Logiswift')).toBe(45);
      expect(pct('Kofi')).toBe(54);
      expect(pct('Esi')).toBe(55);
      expect(pct('Kwesi')).toBe(54);
      expect(row('Kasapa').deliverySuccessRate.value).toBeNull();
      expect(row('Kasapa').deliverySuccessRate.detail?.closed).toBe(0);
    });

    it('closed counts: Logiswift 220 delivered of 490 closed; assigned 590', () => {
      expect(row('Logiswift').deliverySuccessRate.detail).toMatchObject({ delivered: 220, closed: 490 });
      expect(row('Logiswift').assigned).toBe(590);
      expect(row('Kofi').deliverySuccessRate.detail).toMatchObject({ delivered: 82, closed: 152 });
    });

    it('median days: Logiswift 1.4 to dispatch and 3.8 to deliver; Kofi 0.6 and 1.2', () => {
      expect(row('Logiswift').confirmedToDispatchedDays.value).toBe(1.4);
      expect(row('Logiswift').dispatchedToDeliveredDays.value).toBe(3.8);
      expect(row('Kofi').confirmedToDispatchedDays.value).toBe(0.6);
      expect(row('Kofi').dispatchedToDeliveredDays.value).toBe(1.2);
    });
  });
}
