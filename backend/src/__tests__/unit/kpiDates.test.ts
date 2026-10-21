/** M1-T15: store-zone date helpers. Written zone-agnostic: the same boundaries are checked in a UTC+0 zone (Accra), a +13 zone and a -5 zone. */
import { describe, it, expect } from '@jest/globals';
import {
  DEFAULT_TIME_ZONE, daysInMonth, endOfDay, localDate, monthRange, parseBound, parseInclusiveBound, startOfDay, addDays, weekRange,
} from '../../services/kpi/dates';

const ZONES = ['Africa/Accra', 'Pacific/Auckland', 'America/New_York'];

describe('kpi dates', () => {
  it('defaults to Africa/Accra', () => {
    expect(DEFAULT_TIME_ZONE).toBe('Africa/Accra');
  });

  it('day boundary in Accra is UTC midnight', () => {
    expect(startOfDay('2026-10-17', 'Africa/Accra').toISOString()).toBe('2026-10-17T00:00:00.000Z');
    expect(endOfDay('2026-10-17', 'Africa/Accra').toISOString()).toBe('2026-10-18T00:00:00.000Z');
  });

  it.each(ZONES)('a day is [start, next start) and the last millisecond belongs to it (%s)', (zone) => {
    const from = startOfDay('2026-10-17', zone);
    const to = endOfDay('2026-10-17', zone);
    expect(localDate(from, zone)).toBe('2026-10-17');
    expect(localDate(new Date(to.getTime() - 1), zone)).toBe('2026-10-17');
    expect(localDate(to, zone)).toBe('2026-10-18');
    expect(localDate(new Date(from.getTime() - 1), zone)).toBe('2026-10-16');
  });

  it('a zone east of Greenwich starts the local day before the UTC day', () => {
    // Auckland is UTC+13 on 17 Oct 2026 (daylight saving): local midnight is 11:00 UTC the day before.
    expect(startOfDay('2026-10-17', 'Pacific/Auckland').toISOString()).toBe('2026-10-16T11:00:00.000Z');
  });

  it('daysInMonth: 31-day October, 30-day September, February in a leap and a common year', () => {
    expect(daysInMonth(2026, 10)).toBe(31);
    expect(daysInMonth(2026, 9)).toBe(30);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });

  it.each(ZONES)('October is 31 local days, September 30, and they are adjacent (%s)', (zone) => {
    const oct = monthRange(2026, 10, zone);
    const sep = monthRange(2026, 9, zone);
    expect(sep.to.getTime()).toBe(oct.from.getTime());
    expect(monthRange(2026, 11, zone).from.getTime()).toBe(oct.to.getTime());
    expect(localDate(oct.from, zone)).toBe('2026-10-01');
    expect(localDate(new Date(oct.to.getTime() - 1), zone)).toBe('2026-10-31');
    // days in a range = number of distinct local dates
    const dayCount = (r: { from: Date; to: Date }) => {
      const dates = new Set<string>();
      for (let t = r.from.getTime(); t < r.to.getTime(); t += 3600_000) dates.add(localDate(new Date(t), zone));
      return dates.size;
    };
    expect(dayCount(oct)).toBe(31);
    expect(dayCount(sep)).toBe(30);
  });

  it('month range rolls over the year (December)', () => {
    const dec = monthRange(2026, 12, 'Africa/Accra');
    expect(dec.from.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(dec.to.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('parseBound: a date-only `to` is inclusive of that day; an ISO instant is used as given', () => {
    expect(parseBound('2026-10-01', 'from', 'Africa/Accra').toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(parseBound('2026-10-17', 'to', 'Africa/Accra').toISOString()).toBe('2026-10-18T00:00:00.000Z');
    expect(parseBound('2026-10-17T12:30:00.000Z', 'to', 'Africa/Accra').toISOString()).toBe('2026-10-17T12:30:00.000Z');
  });

  it('parseInclusiveBound: a date-only `to` is the last millisecond of that day; ISO is as given unless snapped', () => {
    expect(parseInclusiveBound('2026-10-01', 'from', 'Africa/Accra').toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(parseInclusiveBound('2026-10-17', 'to', 'Africa/Accra').toISOString()).toBe('2026-10-17T23:59:59.999Z');
    expect(parseInclusiveBound('2026-10-17T12:30:00.000Z', 'to', 'Africa/Accra').toISOString()).toBe('2026-10-17T12:30:00.000Z');
    expect(parseInclusiveBound('2026-10-17T12:30:00.000Z', 'to', 'Africa/Accra', { snapToDay: true }).toISOString()).toBe('2026-10-17T23:59:59.999Z');
    // A zone east of UTC: store day 17 Oct in Lagos (UTC+1) ends at 22:59:59.999Z.
    expect(parseInclusiveBound('2026-10-17', 'to', 'Africa/Lagos').toISOString()).toBe('2026-10-17T22:59:59.999Z');
  });

  it('rejects things that are not dates', () => {
    expect(() => startOfDay('2026-02-30')).toThrow(RangeError);
    expect(() => startOfDay('17/10/2026')).toThrow(RangeError);
    expect(() => parseBound('nope', 'from')).toThrow(RangeError);
  });

  it('addDays adds 24 hours per day', () => {
    expect(addDays(new Date('2026-10-01T00:00:00Z'), 30).toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });
});

describe('weekRange', () => {
  it.each([
    ['2026-10-12', '2026-10-12', '2026-10-18'], // a Monday
    ['2026-10-15', '2026-10-12', '2026-10-18'], // a Thursday
    ['2026-10-18', '2026-10-12', '2026-10-18'], // a Sunday belongs to the week that ends on it
    ['2026-10-01', '2026-09-28', '2026-10-04'], // a week across a month end
  ])('%s is in the week %s to %s', (day, monday, sunday) => {
    expect(weekRange(day, 'Africa/Accra')).toMatchObject({ monday, sunday });
  });

  it.each(ZONES)('is [start of Monday, start of the next Monday) in store-zone days (%s)', (zone) => {
    const w = weekRange('2026-10-15', zone);
    expect(w.from.getTime()).toBe(startOfDay('2026-10-12', zone).getTime());
    expect(w.to.getTime()).toBe(startOfDay('2026-10-19', zone).getTime());
  });
});
