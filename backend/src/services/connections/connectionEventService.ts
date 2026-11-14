import { ConnectionEventLevel, Prisma } from '@prisma/client';
import prisma, { prismaBase } from '../../utils/prisma';
import logger from '../../utils/logger';
import { AppError } from '../../middleware/errorHandler';

/**
 * M9-T26 (F-1213): the activity log of the Connections page. One row per connection problem, kept 90 days
 * (connectionEventCleanupQueue deletes older rows).
 */
export const CONNECTION_EVENT_RETENTION_DAYS = 90;
export const CONNECTIONS = ['sms', 'whatsapp', 'email', 'paystack', 'meta', 'checkout', 'webhook', 'csv'] as const;
export type ConnectionName = (typeof CONNECTIONS)[number];

/** The same problem is written once per window: a bad SMS key would otherwise add a row for every message. */
const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const PAGE_SIZE = 50;

export interface ConnectionEventInput {
  tenantId: string;
  connection: ConnectionName;
  level: ConnectionEventLevel;
  message: string;
  data?: Prisma.InputJsonValue;
}

/**
 * Write one activity row. Never throws: a logging failure must not break the job or request that reported the problem.
 * Safe to call with or without a tenant context (it writes with the tenant given).
 */
export async function recordConnectionEvent(input: ConnectionEventInput): Promise<void> {
  try {
    const message = input.message.slice(0, 500);
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const same = await prismaBase.connectionEvent.findFirst({
      where: { tenantId: input.tenantId, connection: input.connection, level: input.level, message, createdAt: { gte: since } },
      select: { id: true },
    });
    if (same) return;
    await prismaBase.connectionEvent.create({
      data: { tenantId: input.tenantId, connection: input.connection, level: input.level, message, details: input.data },
    });
  } catch (err: any) {
    logger.warn('Could not record a connection event', { connection: input.connection, error: err?.message });
  }
}

export type ActivityTab = 'all' | 'error' | 'warning';

const encodeCursor = (row: { createdAt: Date; id: number }) => Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
function decodeCursor(cursor: string): { at: Date; id: number } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || !Number.isInteger(Number(id))) throw new AppError('Bad cursor', 400);
  return { at, id: Number(id) };
}

/** Newest first, with a count for every tab (All, Failed, Warnings). Runs in the tenant context. */
export async function listActivity(tenantId: string, query: { level?: ActivityTab; cursor?: string }) {
  const since = new Date(Date.now() - CONNECTION_EVENT_RETENTION_DAYS * 24 * 3600_000);
  const base: Prisma.ConnectionEventWhereInput = { tenantId, createdAt: { gte: since } };
  const level = query.level ?? 'all';

  const and: Prisma.ConnectionEventWhereInput[] = [base];
  if (level !== 'all') and.push({ level });
  if (query.cursor) {
    const { at, id } = decodeCursor(query.cursor);
    and.push({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] });
  }

  const [grouped, rows] = await Promise.all([
    prisma.connectionEvent.groupBy({ by: ['level'], where: base, _count: { _all: true } }),
    prisma.connectionEvent.findMany({ where: { AND: and }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PAGE_SIZE + 1 }),
  ]);
  const count = (l: ConnectionEventLevel) => grouped.find((g) => g.level === l)?._count._all ?? 0;
  const page = rows.slice(0, PAGE_SIZE);
  return {
    counts: { all: count('info') + count('warning') + count('error'), error: count('error'), warning: count('warning') },
    items: page.map((r) => ({ id: r.id, connection: r.connection, level: r.level, message: r.message, data: r.details, at: r.createdAt })),
    nextCursor: rows.length > PAGE_SIZE ? encodeCursor(page[page.length - 1]) : null,
  };
}

/** Delete the current tenant's rows older than the retention. Returns how many. */
export async function purgeOldConnectionEvents(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CONNECTION_EVENT_RETENTION_DAYS * 24 * 3600_000);
  const result = await prisma.connectionEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}
