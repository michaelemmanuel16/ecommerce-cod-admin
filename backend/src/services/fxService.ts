/**
 * FX service (M1-T30, M1-T31, decision O6, PRD 5.7).
 *
 * Rates are stored per day and pair in FxRate. A pair is (store currency -> extra currency): 1 unit of the store
 * currency buys `rate` units of the extra currency. Sources:
 *   auto   the daily job (createdById null), or "use today's rate" (createdById = the user who asked).
 *   manual the owner typed it. A manual rate wins over auto from its date on and stays until "use today's rate".
 * Nothing is deleted. "Use today's rate" writes an auto row dated today with the user's id; that row ends the
 * manual rate (a later manual rate starts a new one).
 *
 * rateOn() answers the rate of a day, else the nearest earlier day, else (nothing earlier) the nearest later day.
 * It also reads the inverse pair, so a store currency change keeps every old rate usable.
 * The server never rewrites stored amounts: callers convert at read time with the rate of the record's own date.
 */
import { Prisma, FxRate } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import * as Money from '../utils/money';
import { runInTenant } from '../utils/tenantContext';
import { AppError } from '../middleware/errorHandler';
import { getCurrency, setStoreCurrency } from '../utils/currency';
import { getStoreTimeZone, localDate, parseYmd, ymdOfUtc } from './kpi/dates';
import { FxProvider, getFxProvider } from './fx/fxProvider';

const CURRENCY_CODE = /^[A-Z]{3}$/;

interface FxLookup {
  /** Units of `to` for 1 unit of `from`. */
  rate: Money.Money;
  /** Day of the stored row that answered (YYYY-MM-DD). */
  date: string;
  source: 'auto' | 'manual';
  /** False when the row is not the day asked for (nearest earlier or later day): show a note. */
  exact: boolean;
  /** True when the rate is the inverse of the stored opposite pair. */
  inverse: boolean;
}

const dayDate = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);

/** Today in the store zone, YYYY-MM-DD. */
function todayYmd(tenantId: string, now: Date = new Date()): string {
  return localDate(now, getStoreTimeZone(tenantId));
}

function toYmd(tenantId: string, date: Date | string): string {
  if (typeof date === 'string') {
    parseYmd(date);
    return date;
  }
  return localDate(date, getStoreTimeZone(tenantId));
}

function assertCurrency(code: unknown, label = 'currency'): string {
  if (typeof code !== 'string' || !CURRENCY_CODE.test(code.toUpperCase())) {
    throw new AppError(`${label} must be a 3-letter currency code`, 400, 'INVALID_CURRENCY');
  }
  return code.toUpperCase();
}

const newestFirst = [{ date: 'desc' as const }, { createdAt: 'desc' as const }, { id: 'desc' as const }];

/**
 * The stored row that sets the rate of one pair, from rows newest first and all on or before the day asked.
 * A manual row wins unless a "use today" row (auto with a user id) came after it. Otherwise the newest auto row.
 */
function resolveDirect(rows: FxRate[], from: string, to: string): FxRate | null {
  const pair = rows.filter((r) => r.fromCurrency === from && r.toCurrency === to);
  const manual = pair.find((r) => r.source === 'manual');
  const release = pair.find((r) => r.source === 'auto' && r.createdById !== null);
  const auto = pair.find((r) => r.source === 'auto');
  if (manual) {
    const released = release && (release.date > manual.date || (release.date.getTime() === manual.date.getTime() && release.createdAt > manual.createdAt));
    if (!released) return manual;
  }
  return auto ?? manual ?? null;
}

function lookup(row: FxRate, day: Date, inverse: boolean): FxLookup {
  return {
    rate: inverse ? Money.div(1, row.rate) : Money.parse(row.rate),
    date: ymdOfUtc(row.date),
    source: row.source,
    exact: row.date.getTime() === day.getTime(),
    inverse,
  };
}

async function rateOnInTenant(from: string, to: string, ymd: string): Promise<FxLookup | null> {
  if (from === to) return { rate: Money.parse(1), date: ymd, source: 'auto', exact: true, inverse: false };
  const day = dayDate(ymd);
  const pairs = [{ fromCurrency: from, toCurrency: to }, { fromCurrency: to, toCurrency: from }];
  const rows = await prisma.fxRate.findMany({ where: { OR: pairs, date: { lte: day } }, orderBy: newestFirst });
  const direct = resolveDirect(rows, from, to);
  const opposite = resolveDirect(rows, to, from);
  if (direct || opposite) {
    // The newer row answers; on a tie the stored direction wins.
    const useOpposite = !direct || (opposite !== null && opposite.date > direct.date);
    return useOpposite ? lookup(opposite as FxRate, day, true) : lookup(direct as FxRate, day, false);
  }
  // Nothing on or before the day: use the nearest later row rather than fail.
  const later = await prisma.fxRate.findFirst({
    where: { OR: pairs, date: { gt: day } },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  if (!later) return null;
  return lookup(later, day, later.fromCurrency === to);
}

/** The rate of `date` for 1 unit of `from` in `to`: that day, else the nearest earlier day. Null when the pair has no rate at all. */
export function rateOn(tenantId: string, from: string, to: string, date: Date | string): Promise<FxLookup | null> {
  return runInTenant(tenantId, () => rateOnInTenant(from, to, toYmd(tenantId, date)));
}

/**
 * Converts amounts into the store currency at the rate of each record's own day. Call `warm` once with every
 * (currency, day) the amounts need: it looks each pair up once, in parallel. Then `convert` is synchronous.
 * Amounts already in the store currency need no rate.
 */
export function makeConverter(tenantId: string, storeCurrency: string) {
  const rates = new Map<string, Money.Money>();
  const keyOf = (currency: string, ymd: string) => `${currency}|${ymd}`;
  return {
    async warm(pairs: Iterable<{ currency: string | null | undefined; ymd: string }>): Promise<void> {
      const wanted = new Map<string, { currency: string; ymd: string }>();
      for (const { currency, ymd } of pairs) {
        if (currency && currency !== storeCurrency) wanted.set(keyOf(currency, ymd), { currency, ymd });
      }
      await Promise.all([...wanted].map(async ([key, { currency, ymd }]) => {
        // Rates are stored as (store -> other); rateOn(other -> store) reads the inverse of that row.
        const found = await rateOn(tenantId, currency, storeCurrency, ymd);
        if (!found) throw new AppError(`No exchange rate between ${currency} and ${storeCurrency}`, 409, 'NO_FX_RATE');
        rates.set(key, found.rate);
      }));
    },
    convert(amount: Money.MoneyInput, currency: string | null | undefined, ymd: string): Money.Money {
      if (!currency || currency === storeCurrency) return Money.parse(amount);
      const rate = rates.get(keyOf(currency, ymd));
      if (!rate) throw new Error(`Rate ${currency}|${ymd} was not warmed`);
      return Money.mul(amount, rate);
    },
  };
}

/** Currencies in use besides the store currency: every currency that has a stored rate, plus every order currency. Sorted. */
export async function extraCurrencies(tenantId: string): Promise<string[]> {
  return runInTenant(tenantId, async () => {
    const store = await getCurrency();
    const [pairs, orderCurrencies] = await Promise.all([
      prisma.fxRate.groupBy({ by: ['fromCurrency', 'toCurrency'] }),
      prisma.order.groupBy({ by: ['currency'], where: { currency: { not: store } } }),
    ]);
    const set = new Set<string>();
    for (const p of pairs) {
      set.add(p.fromCurrency);
      set.add(p.toCurrency);
    }
    for (const o of orderCurrencies) if (o.currency) set.add(o.currency);
    set.delete(store);
    return [...set].sort();
  });
}

function rateColumn(rate: number | string): string | null {
  try {
    const value = new Prisma.Decimal(rate);
    return value.isFinite() && value.gt(0) ? value.toFixed(8) : null;
  } catch {
    return null;
  }
}

interface RefreshResult {
  pairs: number;
  written: number;
  skipped: string[];
}

/** Rates of one base, fetched once per run when a cache is passed (the job asks the provider once per base). */
async function ratesOf(provider: FxProvider, base: string, cache?: Map<string, Record<string, number>>) {
  const hit = cache?.get(base);
  if (hit) return hit;
  const fetched = await provider.fetchRates(base);
  cache?.set(base, fetched);
  return fetched;
}

/**
 * Writes today's `auto` rows (store -> each target) from fetched provider rates. A target the provider has no usable
 * rate for is skipped. `overwrite` false keeps an existing row of the day (the daily job); true replaces it and marks
 * it with the user's id ("use today's rate").
 */
async function writeAutoRates(
  tenantId: string,
  store: string,
  targets: string[],
  fetched: Record<string, number>,
  date: Date,
  opts: { overwrite: boolean; userId: number | null },
): Promise<{ written: number; rates: FxRate[]; skipped: string[] }> {
  const rows: Array<{ to: string; rate: string }> = [];
  const skipped: string[] = [];
  for (const to of targets) {
    const rate = rateColumn(fetched[to]);
    if (rate) rows.push({ to, rate });
    else skipped.push(to);
  }
  const create = ({ to, rate }: { to: string; rate: string }) => (
    { fromCurrency: store, toCurrency: to, rate, date, source: 'auto' as const, createdById: opts.userId, tenantId }
  );
  return runInTenant(tenantId, async () => {
    if (!opts.overwrite) {
      const { count } = await prisma.fxRate.createMany({ data: rows.map(create), skipDuplicates: true });
      return { written: count, rates: [], skipped };
    }
    const rates = await Promise.all(rows.map((row) => prisma.fxRate.upsert({
      where: { tenantId_fromCurrency_toCurrency_date_source: { tenantId, fromCurrency: store, toCurrency: row.to, date, source: 'auto' } },
      create: create(row),
      update: { rate: row.rate, createdById: opts.userId, createdAt: new Date() },
    })));
    return { written: rates.length, rates, skipped };
  });
}

/**
 * Daily automatic rates of one tenant: one `auto` row per pair (store -> extra currency) for today.
 * The unique key keeps it one row per pair per day; a second run the same day writes nothing.
 */
export async function refreshAutoRates(
  tenantId: string,
  opts: { provider?: FxProvider; cache?: Map<string, Record<string, number>>; now?: Date } = {},
): Promise<RefreshResult> {
  const provider = opts.provider ?? getFxProvider();
  const extras = await extraCurrencies(tenantId);
  const store = await runInTenant(tenantId, () => getCurrency());
  if (extras.length === 0) return { pairs: 0, written: 0, skipped: [] };

  const rates = await ratesOf(provider, store, opts.cache);
  const day = dayDate(todayYmd(tenantId, opts.now));
  const { written, skipped } = await writeAutoRates(tenantId, store, extras, rates, day, { overwrite: false, userId: null });
  if (skipped.length) logger.warn(`FX refresh for tenant ${tenantId}: provider has no rate for ${skipped.join(', ')}`);
  return { pairs: extras.length, written, skipped };
}

/** Store the owner's manual rate for one day (default today). Same day, same pair: the rate is replaced. */
export async function setManualRate(
  tenantId: string,
  userId: number | null,
  input: { to: string; from?: string; rate: number | string; date?: string },
): Promise<FxRate> {
  return runInTenant(tenantId, async () => {
    const store = await getCurrency();
    const from = input.from ? assertCurrency(input.from, 'from') : store;
    const to = assertCurrency(input.to, 'to');
    if (from === to) throw new AppError('from and to must differ', 400, 'INVALID_CURRENCY');
    const rate = rateColumn(input.rate);
    if (!rate) throw new AppError('rate must be a number above 0', 400, 'INVALID_RATE');
    const today = todayYmd(tenantId);
    let ymd = today;
    if (input.date !== undefined) {
      try {
        ymd = toYmd(tenantId, input.date);
      } catch (e) {
        if (e instanceof RangeError) throw new AppError(e.message, 400, 'INVALID_DATE');
        throw e;
      }
    }
    if (ymd > today) throw new AppError('A manual rate cannot be dated in the future', 400, 'INVALID_DATE');
    const date = dayDate(ymd);
    return prisma.fxRate.upsert({
      where: { tenantId_fromCurrency_toCurrency_date_source: { tenantId, fromCurrency: from, toCurrency: to, date, source: 'manual' } },
      create: { fromCurrency: from, toCurrency: to, rate, date, source: 'manual', createdById: userId, tenantId },
      update: { rate, createdById: userId, createdAt: new Date() },
    });
  });
}

/**
 * "Use today's rate": drop the manual override and go back to the daily automatic rate. Fetches the provider
 * now and writes an auto row dated today, marked with the user's id, for `to` (or every extra currency).
 */
export async function useTodaysRate(
  tenantId: string,
  userId: number | null,
  opts: { to?: string; provider?: FxProvider } = {},
): Promise<{ rates: FxRate[]; skipped: string[] }> {
  const provider = opts.provider ?? getFxProvider();
  const store = await runInTenant(tenantId, () => getCurrency());
  const targets = opts.to ? [assertCurrency(opts.to, 'to')] : await extraCurrencies(tenantId);
  if (targets.length === 0) return { rates: [], skipped: [] };

  let fetched: Record<string, number>;
  try {
    fetched = await provider.fetchRates(store);
  } catch (error) {
    logger.error('FX provider failed on use-today:', error);
    throw new AppError('The rate provider is not reachable. Try again later or enter a manual rate.', 502, 'FX_PROVIDER_UNAVAILABLE');
  }
  const { rates, skipped } = await writeAutoRates(tenantId, store, targets, fetched, dayDate(todayYmd(tenantId)), { overwrite: true, userId });
  if (opts.to && skipped.length) throw new AppError(`The provider has no rate for ${skipped[0]}`, 422, 'FX_RATE_NOT_AVAILABLE');
  return { rates, skipped };
}

interface CurrentRate {
  from: string;
  to: string;
  /** Null when the currency has no rate yet. */
  rate: string | null;
  date: string;
  source: 'auto' | 'manual';
  exact: boolean;
}

/** Today's rate for each extra currency (store -> extra). A currency with no rate yet has `rate: null`. */
export async function currentRates(tenantId: string): Promise<{ storeCurrency: string; today: string; rates: CurrentRate[] }> {
  const store = await runInTenant(tenantId, () => getCurrency());
  const today = todayYmd(tenantId);
  const extras = await extraCurrencies(tenantId);
  const rates = await Promise.all(extras.map(async (to) => {
    const found = await rateOn(tenantId, store, to, today);
    return {
      from: store,
      to,
      rate: found ? found.rate.toDecimalPlaces(8).toString() : null,
      date: found?.date ?? today,
      source: found?.source ?? ('auto' as const),
      exact: found?.exact ?? false,
    };
  }));
  return { storeCurrency: store, today, rates };
}

interface HistoryFilter {
  to?: string;
  limit?: number;
}

/** Stored rates, newest first (both sources, the full per-day history). */
export async function rateHistory(tenantId: string, filter: HistoryFilter = {}): Promise<FxRate[]> {
  const to = filter.to ? assertCurrency(filter.to, 'to') : undefined;
  const take = Math.min(Math.max(Math.trunc(filter.limit ?? 100), 1), 500);
  return runInTenant(tenantId, () => prisma.fxRate.findMany({
    where: to ? { OR: [{ toCurrency: to }, { fromCurrency: to }] } : {},
    orderBy: newestFirst,
    take,
  }));
}

/**
 * Change the store currency (O6): allowed at any time, with any number of orders. Stored amounts are not touched;
 * each order keeps its own currency. Rates for the new pairs are fetched at once (best effort).
 */
export async function changeStoreCurrency(tenantId: string, currency: string): Promise<string> {
  const code = assertCurrency(currency);
  const current = await runInTenant(tenantId, () => getCurrency());
  if (code === current) return code;
  await setStoreCurrency(tenantId, code);
  try {
    await refreshAutoRates(tenantId);
  } catch (error) {
    logger.warn(`FX refresh after currency change failed for tenant ${tenantId}: ${(error as Error).message}`);
  }
  return code;
}
