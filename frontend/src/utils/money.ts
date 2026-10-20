import type { AxiosInstance } from 'axios';

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

// Keys that carry money in API payloads and socket events. Phone numbers, ids,
// codes and references are numeric strings too, so those are excluded.
const MONEY_KEY =
  /amount|price|cost|revenue|profit|earning|commission|balance|spent|subtotal|total|discount|expense|cogs|receivable|collect|deposit|expected|bucket_|ordervalue|cash|equity|mrr|fee|payout|income|liabilit|pending|paid|outstanding|due|credit|debit|refund|rate|value|sales/i;
// Id is case-sensitive so "depositPaid" is not mistaken for an id.
const NOT_MONEY_KEY = /code|phone|reference|name|address/i;
const ID_KEY = /^id$|Id$|_id$/;

// Payloads repeat the same few hundred keys thousands of times: decide each key once.
const moneyKeyCache = new Map<string, boolean>();
const isMoneyKey = (key: string): boolean => {
  let isMoney = moneyKeyCache.get(key);
  if (isMoney === undefined) {
    isMoney = MONEY_KEY.test(key) && !NOT_MONEY_KEY.test(key) && !ID_KEY.test(key);
    moneyKeyCache.set(key, isMoney);
  }
  return isMoney;
};

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

/** Normalize every response of an axios client at the edge. */
export const normalizeResponses = (client: AxiosInstance): void => {
  client.interceptors.response.use((response) => {
    normalizeMoney(response.data);
    return response;
  });
};
