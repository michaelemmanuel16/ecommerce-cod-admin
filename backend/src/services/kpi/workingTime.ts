/**
 * Operating hours and working minutes (M1-T22, F-755, risk 28).
 *
 * `SystemConfig.operatingHours` (Json) holds:
 *   { days: { monday: { open: '08:00', close: '20:00', enabled: true }, ... sunday: ... },
 *     firstCallTargetMinutes?: 15, queueWaitAlertMinutes?: 30 }
 * A day that is missing or has enabled=false is closed. A window is one span inside a day (open < close, 'HH:MM').
 * Stored this way (no new columns) until the Operations tab (M7) owns the screen; the keys follow F-1229.
 *
 * workingMinutesBetween counts only the minutes inside the windows, on the store-zone calendar. A start outside
 * hours begins at the next opening. With no hours (null) it counts every minute: the caller shows "Set operating hours".
 */
import { addDays, startOfDay, localDate } from './dates';

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface DayHours { open: string; close: string; enabled: boolean }
export interface OperatingHours {
  days: Partial<Record<Weekday, DayHours>>;
  firstCallTargetMinutes?: number;
  queueWaitAlertMinutes?: number;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MIN_MS = 60_000;

function minutesOfDay(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  return Number(m![1]) * 60 + Number(m![2]);
}

/**
 * Validates the stored or submitted shape. Returns the normalised value, or throws RangeError with a message.
 * Unknown day keys, bad 'HH:MM', close not after open, and non-positive minute settings are rejected.
 */
export function parseOperatingHours(value: unknown): OperatingHours {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new RangeError('operatingHours must be an object');
  const input = value as Record<string, unknown>;
  const days: Partial<Record<Weekday, DayHours>> = {};
  const rawDays = input.days;
  if (typeof rawDays !== 'object' || rawDays === null || Array.isArray(rawDays)) throw new RangeError('operatingHours.days must be an object');
  for (const [key, raw] of Object.entries(rawDays as Record<string, unknown>)) {
    if (!(WEEKDAYS as readonly string[]).includes(key)) throw new RangeError(`operatingHours.days: unknown day "${key}"`);
    const d = raw as Partial<DayHours> | null;
    if (typeof d !== 'object' || d === null) throw new RangeError(`operatingHours.days.${key} must be an object`);
    if (typeof d.enabled !== 'boolean') throw new RangeError(`operatingHours.days.${key}.enabled must be true or false`);
    if (typeof d.open !== 'string' || !HHMM.test(d.open) || typeof d.close !== 'string' || !HHMM.test(d.close)) {
      throw new RangeError(`operatingHours.days.${key}: open and close must be HH:MM`);
    }
    if (minutesOfDay(d.close) <= minutesOfDay(d.open)) throw new RangeError(`operatingHours.days.${key}: close must be after open`);
    days[key as Weekday] = { open: d.open, close: d.close, enabled: d.enabled };
  }
  const out: OperatingHours = { days };
  for (const key of ['firstCallTargetMinutes', 'queueWaitAlertMinutes'] as const) {
    if (input[key] === undefined) continue;
    const n = input[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw new RangeError(`operatingHours.${key} must be a positive number`);
    out[key] = n;
  }
  const { firstCallTargetMinutes: target, queueWaitAlertMinutes: alert } = out;
  if (target !== undefined && alert !== undefined && alert < target) throw new RangeError('queueWaitAlertMinutes must not be below firstCallTargetMinutes');
  return out;
}

/** Same as parseOperatingHours, but a stored value that is empty or bad reads as "not set" (null). */
export function readOperatingHours(value: unknown): OperatingHours | null {
  if (value === null || value === undefined) return null;
  try {
    const hours = parseOperatingHours(value);
    return Object.values(hours.days).some((d) => d?.enabled) ? hours : null;
  } catch {
    return null;
  }
}

/** Weekday of a local calendar day 'YYYY-MM-DD'. */
function weekdayOf(ymd: string): Weekday {
  const [y, m, d] = ymd.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * Minutes between start and end that fall inside the operating hours, in the store zone.
 * End before start counts 0 (a first call before the order was placed is a clock error, clamped). With
 * `hours` null every minute counts. Fractional minutes are kept (seconds count).
 */
export function workingMinutesBetween(start: Date, end: Date, hours: OperatingHours | null, timeZone: string): number {
  if (end <= start) return 0;
  if (!hours) return (end.getTime() - start.getTime()) / MIN_MS;

  // Day bounds are looked up per date string, so a call that crosses a few days computes each midnight once.
  const midnights = new Map<string, number>();
  const midnightOf = (day: string) => {
    let m = midnights.get(day);
    if (m === undefined) { m = startOfDay(day, timeZone).getTime(); midnights.set(day, m); }
    return m;
  };
  const overlapOn = (day: string): number => {
    const window = hours.days[weekdayOf(day)];
    if (!window?.enabled) return 0;
    const midnight = midnightOf(day);
    const open = midnight + minutesOfDay(window.open) * MIN_MS;
    const close = midnight + minutesOfDay(window.close) * MIN_MS;
    return Math.max(0, Math.min(close, end.getTime()) - Math.max(open, start.getTime()));
  };

  const firstDay = localDate(start, timeZone);
  const lastDay = localDate(end, timeZone);
  if (firstDay === lastDay) return overlapOn(firstDay) / MIN_MS;

  let total = 0;
  // Walk local days from the start day to the end day. addDays(.., 1.5) from midnight stays on the next calendar day in any zone.
  for (let day = firstDay; day <= lastDay; day = localDate(addDays(new Date(midnightOf(day)), 1.5), timeZone)) {
    total += overlapOn(day);
  }
  return total / MIN_MS;
}
