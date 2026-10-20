// Money crosses the API as strings ("249.00"), so `a + b` on a raw field
// concatenates and recharts needs numbers. All parsing lives here:
// responses are normalized once at the network edge (axios interceptors,
// embed fetch, socket handlers) and pages keep working with numbers.
// parseMoney is for any value that arrives some other way.

const NUMERIC = /^\s*-?\d+(\.\d+)?\s*$/;

/** "249.00" | "249" | 249 | null | undefined -> number. NaN never escapes. */
export const parseMoney = (value: string | number | null | undefined): number => {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Sum money values; string-safe and rounded to 2dp to drop float noise. */
export const sumMoney = (values: Iterable<string | number | null | undefined>): number => {
  let total = 0;
  for (const v of values) total += parseMoney(v);
  return Math.round(total * 100) / 100;
};

// Keys that carry money in API payloads and socket events. Phone numbers, ids,
// codes and references are numeric strings too, so those are excluded.
const MONEY_KEY =
  /amount|price|cost|revenue|profit|earning|commission|balance|spent|subtotal|total|discount|expense|cogs|receivable|collect|deposit|expected|bucket_|ordervalue|cash|equity|mrr|fee|payout|income|liabilit/i;
const NOT_MONEY_KEY = /code|phone|reference|name|address|id$/i;

const isMoneyKey = (key: string): boolean => MONEY_KEY.test(key) && !NOT_MONEY_KEY.test(key);

/**
 * Walks a JSON payload and turns numeric strings under money keys into numbers,
 * in place (so cached responses are already normalized). Returns the same value.
 */
export const normalizeMoney = <T>(data: T): T => {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
    } else if (node && typeof node === 'object' && Object.getPrototypeOf(node) === Object.prototype) {
      const obj = node as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        const v = obj[key];
        if (typeof v === 'string') {
          if (NUMERIC.test(v) && isMoneyKey(key)) obj[key] = parseMoney(v);
        } else if (v && typeof v === 'object') {
          walk(v);
        }
      }
    }
  };
  walk(data);
  return data;
};
