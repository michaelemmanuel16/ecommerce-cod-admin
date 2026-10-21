import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { getCurrency } from '../utils/currency';
import { endOfDay, getStoreTimeZone, localDate, monthRange, parseBound, parseYmd, shiftYmd, startOfDay } from '../services/kpi/dates';

/**
 * Helpers the tool files share. They turn plain Errors into AppErrors: runTool shows an AppError message to the
 * caller and hides any other message behind a generic one.
 */


/** Cursor from a tool call to a row id. A bad cursor is a 400 with the old message. */
export function cursorId(cursor: string | undefined): number | undefined {
  if (!cursor) return undefined;
  try {
    return decodeCursor(cursor);
  } catch (err) {
    throw new AppError((err as Error).message, 400);
  }
}

/** Store-zone range [from, to) for a period (see getStoreRange). A missing or bad bound is a 400. */
export function storeRange(period: string, dateFrom?: string, dateTo?: string): { from: Date; to: Date } {
  try {
    return getStoreRange(period, dateFrom, dateTo);
  } catch (err) {
    throw new AppError((err as Error).message, 400);
  }
}

/** `limit` field of a paged tool: 1 to 100, 25 by default. */
export const limitField = z.number().int().min(1).max(100).default(25);

/** Tool output that carries money: the tenant currency code first, money fields as 2-decimal strings. */
export async function withCurrency<T extends Record<string, unknown>>(data: T): Promise<{ currency: string } & T> {
  return { currency: await getCurrency(), ...data };
}

/** `next page` marker: the id of the last row when there is a further page. */
export function nextCursorOf(rows: Array<{ id: number }>, hasMore: boolean): string | undefined {
  return hasMore ? encodeCursor(rows[rows.length - 1].id) : undefined;
}

// Cursor pagination
export function encodeCursor(id: number): string {
  return Buffer.from(JSON.stringify({ id })).toString('base64');
}

function decodeCursor(cursor: string): number {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    if (typeof decoded.id !== 'number' || !Number.isInteger(decoded.id) || decoded.id < 1) {
      throw new Error('Invalid cursor: id must be a positive integer');
    }
    return decoded.id;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('Invalid cursor')) throw e;
    throw new Error('Invalid cursor format');
  }
}

// Date helpers
export function getDateRange(period: string, dateFrom?: string, dateTo?: string): { start: Date; end: Date } {
  const now = new Date();
  const end = dateTo ? new Date(dateTo) : now;

  switch (period) {
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);
      return { start, end: dateTo ? end : todayEnd };
    }
    case 'week': {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end };
    }
    case 'custom': {
      if (!dateFrom) throw new Error('dateFrom is required for custom period');
      return { start: new Date(dateFrom), end };
    }
    default:
      throw new Error(`Invalid period: ${period}`);
  }
}

/**
 * Store-zone range [from, to) for the KPI layer (kpi/dates.ts). `to` is exclusive: a date-only `dateTo` is the END of
 * that day, so dateFrom 2026-10-01 and dateTo 2026-10-17 means 1 to 17 October. Periods end at the end of today.
 *   today  = today; week = the last 7 days and today; month = the 1st of this month to today.
 */
function getStoreRange(period: string, dateFrom?: string, dateTo?: string): { from: Date; to: Date } {
  const zone = getStoreTimeZone();
  const today = localDate(new Date(), zone);
  let from: Date;
  switch (period) {
    case 'today':
      from = startOfDay(today, zone);
      break;
    case 'week':
      from = startOfDay(shiftYmd(today, -7), zone);
      break;
    case 'month': {
      const { year, month } = parseYmd(today);
      from = monthRange(year, month, zone).from;
      break;
    }
    case 'custom':
      if (!dateFrom) throw new Error('dateFrom is required for custom period');
      from = parseBound(dateFrom, 'from', zone);
      break;
    default:
      throw new Error(`Invalid period: ${period}`);
  }
  return { from, to: dateTo ? parseBound(dateTo, 'to', zone) : endOfDay(today, zone) };
}

/** The `dateRange` field of a tool result for [from, to): ISO instants, the end as the last instant inside the range (the old tools showed an inclusive end). */
export function dateRangeOut(from: Date, to: Date): { from: string; to: string } {
  return { from: from.toISOString(), to: new Date(to.getTime() - 1).toISOString() };
}
