import { MessageChannel, MessageStatus, Prisma } from '@prisma/client';
import prisma from '../../utils/prisma';
import { isManagerUp } from '../../utils/authUtils';
import { visibilityWhere, Actor } from './conversationService';

/**
 * M9-T08 (F-455, F-456): the ONE definition of every Messages figure. The overview tiles and the message log
 * both read these sets, so a tile can never disagree with the rows behind it.
 *
 *   sent      = the provider took it: sent, delivered, read, replied, or failed after it left
 *   delivered = delivered | read | replied
 *   read      = read | replied
 *   failed    = failed
 *   replied   = replied
 *   skipped   = skipped (never sent: opted out, no number)
 *
 * A row sitting in `pending` is in no tile. Rates divide by `sent`; a zero denominator is null (the UI shows a dash).
 */
export const FIGURES = ['sent', 'delivered', 'read', 'failed', 'replied', 'skipped'] as const;
export type Figure = (typeof FIGURES)[number];

export const FIGURE_STATUSES: Record<Figure, MessageStatus[]> = {
  sent: ['sent', 'delivered', 'read', 'replied', 'failed'],
  delivered: ['delivered', 'read', 'replied'],
  read: ['read', 'replied'],
  failed: ['failed'],
  replied: ['replied'],
  skipped: ['skipped'],
};

/** What the log accepts as `status`: a figure name, or `pending`. */
export const LOG_STATUS_FILTERS = [...FIGURES, 'pending'] as const;
export type LogStatusFilter = (typeof LOG_STATUS_FILTERS)[number];

export const statusesFor = (filter: LogStatusFilter): MessageStatus[] =>
  filter === 'pending' ? ['pending'] : FIGURE_STATUSES[filter];

export interface Figures {
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  replied: number;
  skipped: number;
  /** Percent of sent, one decimal. Null when nothing was sent. */
  deliveredRate: number | null;
  readRate: number | null;
  failedRate: number | null;
  replyRate: number | null;
}

const rate = (part: number, sent: number): number | null => (sent === 0 ? null : Math.round((part / sent) * 1000) / 10);

/** Pure: figures from a count per status. */
export function computeFigures(byStatus: Partial<Record<MessageStatus, number>>): Figures {
  const total = (f: Figure) => FIGURE_STATUSES[f].reduce((n, s) => n + (byStatus[s] ?? 0), 0);
  const sent = total('sent');
  const out = { sent, delivered: total('delivered'), read: total('read'), failed: total('failed'), replied: total('replied'), skipped: total('skipped') };
  return {
    ...out,
    deliveredRate: rate(out.delivered, sent),
    readRate: rate(out.read, sent),
    failedRate: rate(out.failed, sent),
    replyRate: rate(out.replied, sent),
  };
}

export interface LogFilters {
  channel?: MessageChannel;
  status?: LogStatusFilter;
  from?: Date;
  /** Exclusive */
  to?: Date;
  recipient?: string;
}

/**
 * The rows both the tiles and the log count: outbound messages of the tenant, not for a test order, and for a rep
 * only those on an order assigned to them or in a conversation they can see.
 */
export function messageScope(actor: Actor): Prisma.MessageLogWhereInput {
  const and: Prisma.MessageLogWhereInput[] = [
    { tenantId: actor.tenantId, direction: 'outbound' },
    // An order made by a connection test is not a customer message
    { NOT: { order: { isTest: true } } },
  ];
  if (!isManagerUp(actor)) {
    and.push({ OR: [{ order: { customerRepId: actor.id } }, { conversation: visibilityWhere(actor) }] });
  }
  return { AND: and };
}

/** Filters shared by the tiles and the log. `status` is left out of the tiles (they count every status). */
export function filterWhere(filters: LogFilters): Prisma.MessageLogWhereInput[] {
  const and: Prisma.MessageLogWhereInput[] = [];
  if (filters.channel) and.push({ channel: filters.channel });
  if (filters.from || filters.to) and.push({ createdAt: { ...(filters.from && { gte: filters.from }), ...(filters.to && { lt: filters.to }) } });
  return and;
}

export async function overview(actor: Actor, filters: Pick<LogFilters, 'channel' | 'from' | 'to'>) {
  const where: Prisma.MessageLogWhereInput = { AND: [messageScope(actor), ...filterWhere(filters)] };
  const groups = await prisma.messageLog.groupBy({ by: ['channel', 'status'], where, _count: { _all: true } });

  const byChannel = new Map<MessageChannel, Partial<Record<MessageStatus, number>>>();
  for (const g of groups) {
    const counts = byChannel.get(g.channel) ?? {};
    counts[g.status] = (counts[g.status] ?? 0) + g._count._all;
    byChannel.set(g.channel, counts);
  }
  const channels = (filters.channel ? [filters.channel] : (['whatsapp', 'sms', 'email'] as MessageChannel[]));
  // `total` counts every channel under the filters with the same definition, so a screen never adds the channels up itself
  const all: Partial<Record<MessageStatus, number>> = {};
  for (const counts of byChannel.values()) for (const [status, n] of Object.entries(counts)) all[status as MessageStatus] = (all[status as MessageStatus] ?? 0) + (n ?? 0);
  return {
    channels: Object.fromEntries(channels.map((c) => [c, computeFigures(byChannel.get(c) ?? {})])) as Record<string, Figures>,
    total: computeFigures(all),
  };
}
