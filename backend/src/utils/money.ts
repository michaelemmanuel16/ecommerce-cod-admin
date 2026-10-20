import { Prisma } from '@prisma/client';

/**
 * Money helper (M0-T20). Every money value is a Prisma.Decimal (decimal.js).
 * Never do money arithmetic on `number`. Units are major units (GH₵ 249 = 249).
 *
 * API rule: money in a response is a string with 2 decimals, for example "249.00".
 * Use toApi() to write it and parse() to read it.
 *
 * Rounding is half up (decimal.js ROUND_HALF_UP: a tie goes away from zero).
 */

export type Money = Prisma.Decimal;
export type MoneyInput = Prisma.Decimal | string | number;

const Decimal = Prisma.Decimal;

/** Any value at or above this size is a bug, not money. */
const MAX_MONEY = new Decimal('1e15');
export const ZERO: Money = new Decimal(0);

const API_FORMAT = /^-?\d+(\.\d+)?$/;

function guard(value: Money): Money {
  if (!value.isFinite() || value.abs().gte(MAX_MONEY)) {
    throw new RangeError(`Money value out of range: ${value.toString()}`);
  }
  return value;
}

/** Convert a JS number. Throws on NaN, Infinity and values above 1e15. */
export function fromNumber(n: number): Money {
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new TypeError(`Money cannot be built from ${String(n)}`);
  }
  return guard(new Decimal(n));
}

/** Convert an API string such as "249.00". Throws on anything that is not a plain decimal. */
function fromApi(s: string): Money {
  if (typeof s !== 'string' || !API_FORMAT.test(s.trim())) {
    throw new TypeError(`Money cannot be built from ${JSON.stringify(s)}`);
  }
  return guard(new Decimal(s.trim()));
}

/** Accept a Decimal, an API string or a number (also a Prisma Decimal-like object from the DB). */
export function parse(v: MoneyInput): Money {
  if (typeof v === 'number') return fromNumber(v);
  if (typeof v === 'string') return fromApi(v);
  if (Decimal.isDecimal(v)) return guard(v);
  throw new TypeError(`Money cannot be built from ${String(v)}`);
}

/** Null-safe parse: null and undefined are zero. Use it on `_sum` aggregates and optional columns. */
export function orZero(v: MoneyInput | null | undefined): Money {
  return v === null || v === undefined ? ZERO : parse(v);
}

/** Like parse, but returns null for empty, invalid or out-of-range input. For form input. */
export function tryParse(v: unknown): Money | null {
  if (v === null || v === undefined || v === '') return null;
  try {
    return parse(v as MoneyInput);
  } catch {
    return null;
  }
}

export function add(a: MoneyInput, b: MoneyInput): Money {
  return guard(parse(a).plus(parse(b)));
}

export function sub(a: MoneyInput, b: MoneyInput): Money {
  return guard(parse(a).minus(parse(b)));
}

export function mul(a: MoneyInput, b: MoneyInput): Money {
  return guard(parse(a).times(parse(b)));
}

/** Divide. Throws on a zero divisor. The result keeps 20 significant digits; round it yourself. */
export function div(a: MoneyInput, b: MoneyInput): Money {
  const divisor = parse(b);
  if (divisor.isZero()) throw new RangeError('Money division by zero');
  return guard(parse(a).div(divisor));
}

export function sum(values: Iterable<MoneyInput>): Money {
  let total: Money = ZERO;
  for (const v of values) total = total.plus(parse(v));
  return guard(total);
}

/** Round half up to `dp` decimal places. */
export function roundHalfUp(a: MoneyInput, dp = 2): Money {
  return guard(parse(a).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP));
}

/** Negative if a < b, 0 if equal, positive if a > b. */
export function compare(a: MoneyInput, b: MoneyInput): number {
  return parse(a).comparedTo(parse(b));
}
export const gt = (a: MoneyInput, b: MoneyInput): boolean => parse(a).gt(parse(b));
export const lt = (a: MoneyInput, b: MoneyInput): boolean => parse(a).lt(parse(b));

/** API form: string with 2 decimals, rounded half up. */
export function toApi(a: MoneyInput): string {
  return (Decimal.isDecimal(a) ? a : parse(a)).toFixed(2, Decimal.ROUND_HALF_UP);
}

/** True for a non-zero value; null and undefined count as zero. */
export function isNonZero(v: MoneyInput | null | undefined): boolean {
  return !orZero(v).isZero();
}

/** a / b as a percentage number. Zero when b is not positive. */
export function percent(a: MoneyInput, b: MoneyInput): number {
  return gt(b, 0) ? mul(div(a, b), 100).toNumber() : 0;
}

/** "GHS 1,234.50": 2 decimals and thousands separators, no float conversion. */
export function format(a: MoneyInput, currency: string): string {
  const [whole, decimals] = toApi(a).split('.');
  return `${currency} ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${decimals}`;
}

/**
 * JSON.stringify replacer for API output (M0-T24): every Prisma.Decimal becomes its toApi() string.
 * JSON.stringify calls Decimal.toJSON() before the replacer runs ("249"), so the replacer reads the
 * original value from the holder (`this[key]`). Installed once on the Express app
 * (`app.set('json replacer', ...)`), in the MCP JSON helper and in the response cache.
 * All Decimal columns in the schema are money, so no Decimal escapes as a bare number string.
 */
export function jsonReplacer(this: any, key: string, value: unknown): unknown {
  const original = this?.[key];
  return Decimal.isDecimal(original) ? toApi(original) : value;
}

/** Paystack boundary: major units to integer minor units (pesewas/kobo), half up. */
export function toMinor(a: MoneyInput): number {
  return roundHalfUp(mul(a, 100), 0).toNumber();
}

/** Paystack boundary: minor units (an integer from Paystack) to major units. */
export function fromMinor(minor: MoneyInput): Money {
  return div(minor, 100);
}
