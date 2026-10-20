/** M1-T22 (F-755): working minutes inside operating hours, the hours shape, and the median helper. */
import { describe, it, expect } from '@jest/globals';
import { workingMinutesBetween, parseOperatingHours, readOperatingHours, OperatingHours } from '../../services/kpi/workingTime';
import { median } from '../../services/kpi/median';

const ACCRA = 'Africa/Accra';
const weekday = { open: '08:00', close: '20:00', enabled: true };
// Mon to Fri 08:00-20:00, Sat 09:00-18:00, Sun off (NUMBERS.md).
const HOURS: OperatingHours = {
  days: {
    monday: weekday, tuesday: weekday, wednesday: weekday, thursday: weekday, friday: weekday,
    saturday: { open: '09:00', close: '18:00', enabled: true },
    sunday: { open: '10:00', close: '16:00', enabled: false },
  },
};
const at = (iso: string) => new Date(iso);

describe('workingMinutesBetween', () => {
  it('order at 22:30, first call 08:12 next day = 12 minutes (the F-755 example)', () => {
    // 2026-10-06 is a Tuesday, 2026-10-07 a Wednesday. Accra is UTC+0.
    expect(workingMinutesBetween(at('2026-10-06T22:30:00Z'), at('2026-10-07T08:12:00Z'), HOURS, ACCRA)).toBe(12);
  });

  it('same example in a zone east of Greenwich: instants shift, the answer does not', () => {
    // Lagos is UTC+1: 22:30 local = 21:30Z, 08:12 local = 07:12Z.
    expect(workingMinutesBetween(at('2026-10-06T21:30:00Z'), at('2026-10-07T07:12:00Z'), HOURS, 'Africa/Lagos')).toBe(12);
  });

  it('inside one window counts wall minutes', () => {
    expect(workingMinutesBetween(at('2026-10-06T10:00:00Z'), at('2026-10-06T10:45:00Z'), HOURS, ACCRA)).toBe(45);
  });

  it('spans closing time: 19:50 to 08:05 next day = 10 + 5', () => {
    expect(workingMinutesBetween(at('2026-10-06T19:50:00Z'), at('2026-10-07T08:05:00Z'), HOURS, ACCRA)).toBe(15);
  });

  it('a whole working day counts the window length, and a closed span counts 0', () => {
    expect(workingMinutesBetween(at('2026-10-06T00:00:00Z'), at('2026-10-07T00:00:00Z'), HOURS, ACCRA)).toBe(12 * 60);
    expect(workingMinutesBetween(at('2026-10-06T20:00:00Z'), at('2026-10-07T08:00:00Z'), HOURS, ACCRA)).toBe(0);
  });

  it('weekend: Friday 19:50 to Monday 08:10 counts Fri 10 + Sat 540 (09-18) + Sun off + Mon 10', () => {
    expect(workingMinutesBetween(at('2026-10-09T19:50:00Z'), at('2026-10-12T08:10:00Z'), HOURS, ACCRA)).toBe(10 + 540 + 10);
  });

  it('a day with enabled=false or no entry is closed', () => {
    const noSat: OperatingHours = { days: { ...HOURS.days, saturday: { open: '09:00', close: '18:00', enabled: false } } };
    expect(workingMinutesBetween(at('2026-10-10T10:00:00Z'), at('2026-10-10T12:00:00Z'), noSat, ACCRA)).toBe(0);
    const onlyMon: OperatingHours = { days: { monday: weekday } };
    expect(workingMinutesBetween(at('2026-10-06T10:00:00Z'), at('2026-10-06T12:00:00Z'), onlyMon, ACCRA)).toBe(0);
  });

  it('no hours set: counts wall minutes', () => {
    expect(workingMinutesBetween(at('2026-10-06T22:30:00Z'), at('2026-10-07T08:12:00Z'), null, ACCRA)).toBe(582);
  });

  it('end before start (clock error) is clamped to 0', () => {
    expect(workingMinutesBetween(at('2026-10-06T10:00:00Z'), at('2026-10-06T09:00:00Z'), HOURS, ACCRA)).toBe(0);
    expect(workingMinutesBetween(at('2026-10-06T10:00:00Z'), at('2026-10-06T09:00:00Z'), null, ACCRA)).toBe(0);
  });

  it('counts seconds as fractions of a minute', () => {
    expect(workingMinutesBetween(at('2026-10-06T10:00:00Z'), at('2026-10-06T10:00:30Z'), HOURS, ACCRA)).toBe(0.5);
  });
});

describe('operating hours shape', () => {
  it('accepts the stored shape and keeps target and alert', () => {
    const parsed = parseOperatingHours({ ...HOURS, firstCallTargetMinutes: 15, queueWaitAlertMinutes: 30 });
    expect(parsed.firstCallTargetMinutes).toBe(15);
    expect(parsed.queueWaitAlertMinutes).toBe(30);
  });

  it.each([
    ['not an object', 'nope'],
    ['no days', {}],
    ['unknown day', { days: { funday: weekday } }],
    ['bad time', { days: { monday: { open: '8am', close: '20:00', enabled: true } } }],
    ['close before open', { days: { monday: { open: '20:00', close: '08:00', enabled: true } } }],
    ['enabled missing', { days: { monday: { open: '08:00', close: '20:00' } } }],
    ['target not positive', { days: {}, firstCallTargetMinutes: 0 }],
    ['alert below target', { days: {}, firstCallTargetMinutes: 30, queueWaitAlertMinutes: 15 }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseOperatingHours(value)).toThrow(RangeError);
  });

  it('readOperatingHours: empty, bad, or all-closed reads as not set (null)', () => {
    expect(readOperatingHours(null)).toBeNull();
    expect(readOperatingHours({ rubbish: true })).toBeNull();
    expect(readOperatingHours({ days: { monday: { ...weekday, enabled: false } } })).toBeNull();
    expect(readOperatingHours(HOURS)).not.toBeNull();
  });
});

describe('median', () => {
  it('odd, even, empty, unsorted', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(median([9])).toBe(9);
  });
});
