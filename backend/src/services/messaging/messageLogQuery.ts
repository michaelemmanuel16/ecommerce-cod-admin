import { MessageChannel, Prisma } from '@prisma/client';
import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';
import { Actor } from './conversationService';
import { filterWhere, LogFilters, messageScope, statusesFor } from './messageStats';

const PAGE_SIZE = 50;

export interface LogQuery extends LogFilters {
  cursor?: string;
  limit?: number;
}

const encodeCursor = (row: { createdAt: Date; id: number }) => Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
function decodeCursor(cursor: string): { at: Date; id: number } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || !Number.isInteger(Number(id))) throw new AppError('Bad cursor', 400);
  return { at, id: Number(id) };
}

const nameOf = (c: { firstName: string; lastName: string }) => `${c.firstName} ${c.lastName}`.trim();

/** The `where` of the log: the same scope and filters the tiles use, plus the status figure and the recipient. */
export function logWhere(actor: Actor, q: LogFilters): Prisma.MessageLogWhereInput {
  const and: Prisma.MessageLogWhereInput[] = [messageScope(actor), ...filterWhere(q)];
  if (q.status) and.push({ status: { in: statusesFor(q.status) } });
  if (q.recipient) {
    const text = q.recipient.trim();
    const digits = text.replace(/\D/g, '');
    and.push({
      OR: [
        { metadata: { path: ['to'], string_contains: text } },
        ...(digits.length >= 3 ? [{ metadata: { path: ['to'], string_contains: digits } }] : []),
        { customer: { OR: [{ firstName: { contains: text, mode: 'insensitive' as const } }, { lastName: { contains: text, mode: 'insensitive' as const } }] } },
      ],
    });
  }
  return { AND: and };
}

/** Newest first. A message to a deleted customer keeps the stored phone and gets no customer link. */
export async function listLog(actor: Actor, q: LogQuery) {
  const and: Prisma.MessageLogWhereInput[] = [logWhere(actor, q)];
  if (q.cursor) {
    const { at, id } = decodeCursor(q.cursor);
    and.push({ OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] });
  }
  const limit = q.limit ?? PAGE_SIZE;
  const rows = await prisma.messageLog.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    select: {
      id: true, channel: true, status: true, createdAt: true, sentAt: true, templateName: true, errorMessage: true, metadata: true,
      orderId: true, customerId: true,
    },
  });
  const page = rows.slice(0, limit);

  // Looked up apart so a deleted order or customer (hidden by the soft-delete rules) simply has no link
  const customerIds = [...new Set(page.map((r) => r.customerId).filter((v): v is number => v != null))];
  const orderIds = [...new Set(page.map((r) => r.orderId).filter((v): v is number => v != null))];
  const [customers, orders] = await Promise.all([
    customerIds.length ? prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, firstName: true, lastName: true } }) : [],
    orderIds.length ? prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true } }) : [],
  ]);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const items = page.map((r) => {
    const customer = r.customerId != null ? customerById.get(r.customerId) : undefined;
    const order = r.orderId != null ? orderById.get(r.orderId) : undefined;
    const to = (r.metadata as { to?: unknown } | null)?.to;
    return {
      id: r.id,
      channel: r.channel as MessageChannel,
      status: r.status,
      // The phone or email the message was sent to, kept on the row
      recipient: typeof to === 'string' ? to : null,
      at: r.createdAt,
      sentAt: r.sentAt,
      templateName: r.templateName,
      errorMessage: r.errorMessage,
      order: order ? { id: order.id } : null,
      customer: customer ? { id: customer.id, name: nameOf(customer) } : null,
    };
  });
  return { items, nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null };
}
