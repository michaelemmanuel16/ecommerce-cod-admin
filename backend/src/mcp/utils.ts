import { z } from 'zod';
import { MCP_CONFIG } from './config';
import * as Money from '../utils/money';
import { getCurrency } from '../utils/currency';
import { endOfDay, getStoreTimeZone, localDate, monthRange, parseBound, parseYmd, shiftYmd, startOfDay } from '../services/kpi/dates';

// Cursor pagination utilities
export function encodeCursor(id: number): string {
  return Buffer.from(JSON.stringify({ id })).toString('base64');
}

export function decodeCursor(cursor: string): number {
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

// Common Zod schemas
export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(MCP_CONFIG.pagination.maxLimit).default(MCP_CONFIG.pagination.defaultLimit).optional(),
  cursor: z.string().optional(),
});

export const periodSchema = z.enum(['today', 'week', 'month', 'custom']);

export const dateRangeSchema = z.object({
  dateFrom: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  dateTo: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
});

// MCP response helpers
export function mcpText(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function mcpJson(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, Money.jsonReplacer, 2) }] };
}

/** mcpJson with the tenant currency added as `currency`: tool money values are 2-decimal strings in that unit. */
export async function mcpMoneyJson(data: Record<string, unknown>) {
  return mcpJson({ currency: await getCurrency(), ...data });
}

export function mcpError(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
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
export function getStoreRange(period: string, dateFrom?: string, dateTo?: string): { from: Date; to: Date } {
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

/** The last instant inside [from, to), for the `dateRange` field of a tool result (the old tools showed an inclusive end). */
export function inclusiveEnd(to: Date): Date {
  return new Date(to.getTime() - 1);
}
