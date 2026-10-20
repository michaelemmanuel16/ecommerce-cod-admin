/**
 * Store-zone date helpers for the KPI layer (M1-T15, F-250, risk #28).
 *
 * "Today", a month and a cohort day are boundaries in the store's time zone, never in the server's.
 * Ranges are [from, to): `from` inclusive, `to` exclusive, as UTC instants. No dependency: the zone
 * offset comes from Intl, so the helpers work for any IANA zone (including ones with daylight saving).
 *
 * Time zone source: there is no tenant time zone setting yet (Tenant has region and currency only;
 * SystemConfig has operatingHours but no zone). Every tenant uses DEFAULT_TIME_ZONE until a setting
 * lands (Settings screen, M6). Every helper takes `zone` as a required argument, so that change is one line in
 * getStoreTimeZone (the only place that knows the default).
 */
export const DEFAULT_TIME_ZONE = 'Africa/Accra';

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Time zone of a tenant. Constant today (see the file comment). */
/* _tenantId is the seam for the per-tenant setting: callers already pass it. */
export function getStoreTimeZone(_tenantId?: string | null): string {
  return DEFAULT_TIME_ZONE;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(zone, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a zone. */
function zonedParts(instant: Date, zone: string) {
  const p: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(instant)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}

/** Zone offset from UTC in ms at an instant (positive east of Greenwich). */
function offsetMs(instant: Date, zone: string): number {
  const p = zonedParts(instant, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The UTC instant at which the zone's wall clock shows y-m-d 00:00 (month 1-12). Handles day overflow. */
function localMidnight(year: number, month: number, day: number, zone: string): Date {
  const naive = Date.UTC(year, month - 1, day);
  // The offset at the guess may differ from the offset at the real instant on a daylight-saving day: iterate once more.
  let guess = naive - offsetMs(new Date(naive), zone);
  guess = naive - offsetMs(new Date(guess), zone);
  return new Date(guess);
}

/** Local calendar date 'YYYY-MM-DD' of an instant in the zone. */
export function localDate(instant: Date, zone: string): string {
  const p = zonedParts(instant, zone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseYmd(ymd: string): { year: number; month: number; day: number } {
  const m = YMD.exec(ymd);
  if (!m) throw new RangeError(`Expected a date as YYYY-MM-DD, got ${JSON.stringify(ymd)}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`Not a real calendar date: ${ymd}`);
  }
  return { year, month, day };
}

/** Start of the local day 'YYYY-MM-DD', as a UTC instant. */
export function startOfDay(ymd: string, zone: string): Date {
  const { year, month, day } = parseYmd(ymd);
  return localMidnight(year, month, day, zone);
}

/** End of the local day (exclusive): the start of the next local day. */
export function endOfDay(ymd: string, zone: string): Date {
  const { year, month, day } = parseYmd(ymd);
  return localMidnight(year, month, day + 1, zone);
}

/** Days in a calendar month (month 1-12). October is 31, September 30, February 28 or 29. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** [from, to) of a local calendar month (month 1-12). */
export function monthRange(year: number, month: number, zone: string) {
  return { from: localMidnight(year, month, 1, zone), to: localMidnight(year, month + 1, 1, zone) };
}

/**
 * Turn a query value into a range bound.
 *  - 'YYYY-MM-DD' is a local calendar day. As `from` it is the start of that day. As `to` it is the END of
 *    that day (exclusive bound = start of the next day), so "from=2026-10-01&to=2026-10-17" means 1 to 17 October.
 *  - Anything else must be an ISO 8601 instant and is used as given: [from, to) exactly.
 */
export function parseBound(value: string, edge: 'from' | 'to', zone: string): Date {
  if (YMD.test(value)) return edge === 'from' ? startOfDay(value, zone) : endOfDay(value, zone);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new RangeError(`Not a date: ${JSON.stringify(value)}`);
  return d;
}

/** Add whole days to an instant (no zone arithmetic: 24 h each). For "30 days after placement". */
export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * DAY_MS);
}
