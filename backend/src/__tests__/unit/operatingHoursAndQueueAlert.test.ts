import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { workingMinutesBetween, parseOperatingHours, OperatingHours } from '../../services/kpi/workingTime';

const ACCRA = 'Africa/Accra';
const weekday = { open: '08:00', close: '20:00', enabled: true };
const standardHours: OperatingHours = {
  days: {
    monday: weekday,
    tuesday: weekday,
    wednesday: weekday,
    thursday: weekday,
    friday: weekday,
    saturday: { open: '09:00', close: '18:00', enabled: true },
    sunday: { open: '10:00', close: '16:00', enabled: false },
  },
  firstCallTargetMinutes: 15,
  queueWaitAlertMinutes: 30,
};

const at = (iso: string) => new Date(iso);

describe('M7-T05: Operating hours and time-to-first-call clock unit tests', () => {
  describe('overnight gap', () => {
    it('order at 21:00, opening 08:00, first call 08:10 = 10 min', () => {
      // 2026-10-06 is Tuesday (08:00-20:00), 2026-10-07 is Wednesday (08:00-20:00).
      // Order placed at 21:00 (after 20:00 close). Opens next day at 08:00. First call at 08:10.
      const orderAt = at('2026-10-06T21:00:00Z');
      const firstCallAt = at('2026-10-07T08:10:00Z');
      expect(workingMinutesBetween(orderAt, firstCallAt, standardHours, ACCRA)).toBe(10);
    });

    it('order at 19:50 before close, first call 08:10 next morning = 10 min + 10 min = 20 min', () => {
      const orderAt = at('2026-10-06T19:50:00Z');
      const firstCallAt = at('2026-10-07T08:10:00Z');
      expect(workingMinutesBetween(orderAt, firstCallAt, standardHours, ACCRA)).toBe(20);
    });

    it('rejects overnight ranges (close before open) with RangeError', () => {
      expect(() =>
        parseOperatingHours({
          days: { monday: { open: '20:00', close: '08:00', enabled: true } },
        })
      ).toThrow(RangeError);

      expect(() =>
        parseOperatingHours({
          days: { tuesday: { open: '18:00', close: '09:00', enabled: true } },
        })
      ).toThrow(RangeError);

      expect(() =>
        parseOperatingHours({
          days: { wednesday: { open: '10:00', close: '10:00', enabled: true } },
        })
      ).toThrow(RangeError);
    });
  });

  describe('weekend closed day', () => {
    it('order placed Friday night (after close), Saturday open (09:00-18:00 = 540 min), Sunday closed, Monday call at 08:10 = 550 min', () => {
      // 2026-10-09 is Friday, 2026-10-10 is Saturday, 2026-10-11 is Sunday (closed), 2026-10-12 is Monday.
      const orderAt = at('2026-10-09T21:00:00Z');
      const firstCallAt = at('2026-10-12T08:10:00Z');
      // Fri night: 0. Sat: 540 min. Sun: 0 min. Mon: 10 min. Total = 550 min.
      expect(workingMinutesBetween(orderAt, firstCallAt, standardHours, ACCRA)).toBe(550);
    });

    it('weekend closed (Sat and Sun closed): order Friday night, Monday call at 08:10 = 10 min', () => {
      const closedWeekendHours: OperatingHours = {
        days: {
          ...standardHours.days,
          saturday: { open: '09:00', close: '18:00', enabled: false },
          sunday: { open: '10:00', close: '16:00', enabled: false },
        },
      };
      const orderAt = at('2026-10-09T21:00:00Z');
      const firstCallAt = at('2026-10-12T08:10:00Z');
      expect(workingMinutesBetween(orderAt, firstCallAt, closedWeekendHours, ACCRA)).toBe(10);
    });
  });

  describe('first morning order', () => {
    it('order placed at 07:30 (before opening 08:00), first call at 08:15 = 15 min', () => {
      const orderAt = at('2026-10-06T07:30:00Z');
      const firstCallAt = at('2026-10-06T08:15:00Z');
      expect(workingMinutesBetween(orderAt, firstCallAt, standardHours, ACCRA)).toBe(15);
    });

    it('order placed at 08:00 (exact opening), first call at 08:10 = 10 min', () => {
      const orderAt = at('2026-10-06T08:00:00Z');
      const firstCallAt = at('2026-10-06T08:10:00Z');
      expect(workingMinutesBetween(orderAt, firstCallAt, standardHours, ACCRA)).toBe(10);
    });
  });

  describe('clamp to 0', () => {
    it('first call before order clamps to 0', () => {
      const orderAt = at('2026-10-06T10:00:00Z');
      const firstCallAt = at('2026-10-06T09:00:00Z');
      expect(workingMinutesBetween(orderAt, firstCallAt, standardHours, ACCRA)).toBe(0);
    });

    it('first call at exact order time clamps to 0', () => {
      const orderAt = at('2026-10-06T10:00:00Z');
      const firstCallAt = at('2026-10-06T10:00:00Z');
      expect(workingMinutesBetween(orderAt, firstCallAt, standardHours, ACCRA)).toBe(0);
    });

    it('first call before order with null hours clamps to 0', () => {
      const orderAt = at('2026-10-06T10:00:00Z');
      const firstCallAt = at('2026-10-06T09:00:00Z');
      expect(workingMinutesBetween(orderAt, firstCallAt, null, ACCRA)).toBe(0);
    });
  });

  describe('parseOperatingHours with defaultDaysToPay and lowStockCoverDays', () => {
    it('parses valid defaultDaysToPay and lowStockCoverDays', () => {
      const parsed = parseOperatingHours({
        days: { monday: weekday },
        defaultDaysToPay: 7,
        lowStockCoverDays: 14,
      });
      expect(parsed.defaultDaysToPay).toBe(7);
      expect(parsed.lowStockCoverDays).toBe(14);
    });

    it('rejects 0 and negative defaultDaysToPay', () => {
      expect(() =>
        parseOperatingHours({
          days: { monday: weekday },
          defaultDaysToPay: 0,
        })
      ).toThrow(RangeError);
      expect(() =>
        parseOperatingHours({
          days: { monday: weekday },
          defaultDaysToPay: -1,
        })
      ).toThrow(RangeError);
    });

    it('rejects fractional defaultDaysToPay', () => {
      expect(() =>
        parseOperatingHours({
          days: { monday: weekday },
          defaultDaysToPay: 2.5,
        })
      ).toThrow(RangeError);
    });

    it('rejects string defaultDaysToPay without coercion', () => {
      expect(() =>
        parseOperatingHours({
          days: { monday: weekday },
          defaultDaysToPay: '7' as any,
        })
      ).toThrow(RangeError);
    });

    it('rejects 0 and negative lowStockCoverDays', () => {
      expect(() =>
        parseOperatingHours({
          days: { monday: weekday },
          lowStockCoverDays: 0,
        })
      ).toThrow(RangeError);
      expect(() =>
        parseOperatingHours({
          days: { monday: weekday },
          lowStockCoverDays: -1,
        })
      ).toThrow(RangeError);
    });

    it('rejects fractional lowStockCoverDays', () => {
      expect(() =>
        parseOperatingHours({
          days: { monday: weekday },
          lowStockCoverDays: 2.5,
        })
      ).toThrow(RangeError);
    });

    it('rejects string lowStockCoverDays without coercion', () => {
      expect(() =>
        parseOperatingHours({
          days: { monday: weekday },
          lowStockCoverDays: '14' as any,
        })
      ).toThrow(RangeError);
    });
  });
});
