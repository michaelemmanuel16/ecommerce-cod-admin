import { Notification, NotificationKind, Prisma } from '@prisma/client';
import prisma from '../../utils/prisma';
import { AppError } from '../../middleware/errorHandler';
import { customerScope, orderScope, Requester } from '../../utils/authUtils';
import { isOwnerRole } from './inboxEvents';

/** Inbox feed (M9-T17): views, status, cursor paging, read, done, snooze, mark all and counts. Every read is from the database. */

export const INBOX_VIEWS = ['all', 'alerts', 'replies', 'mentions', 'reminders', 'notes', 'assigned'] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];
export const INBOX_STATUSES = ['open', 'done', 'snoozed'] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

const VIEW_KIND: Record<Exclude<InboxView, 'all' | 'assigned'>, NotificationKind> = {
  alerts: 'alert', replies: 'reply', mentions: 'mention', reminders: 'reminder', notes: 'note',
};

export type InboxCounts = Record<InboxView, number>;
export interface InboxUser { id: number; role: string }

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

/** Subject types the inbox can link to. `connection` has no row of its own, so it is never "deleted". */
const SUBJECT_TYPES = ['order', 'customer', 'payout', 'product', 'conversation', 'workflow', 'connection'] as const;

type Where = Prisma.NotificationWhereInput;

/** Open: not done, and not snoozed into the future. */
const openWhere = (now: Date): Where => ({ doneAt: null, OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }] });

/**
 * Rows about orders and conversations that are assigned to this person. The id sets come from the person's own
 * rows (two grouped reads), then one read per subject type checks the assignment.
 */
async function assignedSubjectFilter(userId: number): Promise<Where> {
  const pairs = await prisma.notification.groupBy({
    by: ['subjectType', 'subjectId'],
    where: { userId, subjectType: { in: ['order', 'conversation'] }, subjectId: { not: null } },
  });
  const idsOf = (type: string) => pairs.filter((p) => p.subjectType === type).map((p) => p.subjectId as number);
  const [orders, conversations] = await Promise.all([
    idsOf('order').length
      ? prisma.order.findMany({ where: { id: { in: idsOf('order') }, OR: [{ customerRepId: userId }, { deliveryAgentId: userId }] }, select: { id: true } })
      : [],
    idsOf('conversation').length
      ? prisma.conversation.findMany({ where: { id: { in: idsOf('conversation') }, assignedToId: userId }, select: { id: true } })
      : [],
  ]);
  return {
    OR: [
      { subjectType: 'order', subjectId: { in: orders.map((o) => o.id) } },
      { subjectType: 'conversation', subjectId: { in: conversations.map((c) => c.id) } },
    ],
  };
}

const encodeCursor = (row: { createdAt: Date; id: number }) => Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');

function decodeCursor(cursor: string): { createdAt: Date; id: number } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(iso);
  const n = Number(id);
  if (Number.isNaN(createdAt.getTime()) || !Number.isInteger(n)) throw new AppError('Invalid cursor', 400);
  return { createdAt, id: n };
}

export interface FeedQuery {
  view: InboxView;
  status: InboxStatus;
  scope: 'mine' | 'all';
  cursor?: string;
  limit?: number;
}

/** One existence read per subject type for a whole page. A row whose subject is gone says so. */
async function subjectDeletedMap(rows: Notification[]): Promise<Set<string>> {
  const byType = new Map<string, Set<number>>();
  for (const r of rows) {
    if (!r.subjectType || r.subjectId == null || !(SUBJECT_TYPES as readonly string[]).includes(r.subjectType)) continue;
    if (!byType.has(r.subjectType)) byType.set(r.subjectType, new Set());
    byType.get(r.subjectType)!.add(r.subjectId);
  }
  const alive = new Set<string>();
  const lookups: Array<[string, (ids: number[]) => Promise<{ id: number }[]>]> = [
    ['order', (ids) => prisma.order.findMany({ where: { id: { in: ids } }, select: { id: true } })],
    ['customer', (ids) => prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true } })],
    ['payout', (ids) => prisma.payout.findMany({ where: { id: { in: ids } }, select: { id: true } })],
    ['product', (ids) => prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } })],
    ['conversation', (ids) => prisma.conversation.findMany({ where: { id: { in: ids } }, select: { id: true } })],
    ['workflow', (ids) => prisma.workflow.findMany({ where: { id: { in: ids } }, select: { id: true } })],
  ];
  await Promise.all(lookups.filter(([type]) => byType.has(type)).map(async ([type, find]) => {
    for (const r of await find([...byType.get(type)!])) alive.add(`${type}:${r.id}`);
  }));
  const gone = new Set<string>();
  for (const [type, ids] of byType) {
    if (type === 'connection') continue;
    for (const id of ids) if (!alive.has(`${type}:${id}`)) gone.add(`${type}:${id}`);
  }
  return gone;
}

/**
 * Subjects this person can no longer open: an order that moved to another rep, a customer who left their scope.
 * Only the scoped roles (call rep, delivery agent) can lose access; one read per subject type for the page, using the
 * same `orderScope` and `customerScope` rules as the order and customer APIs.
 */
async function subjectNoAccessSet(rows: Notification[], gone: Set<string>, user?: { id: number; role: string }): Promise<Set<string>> {
  const out = new Set<string>();
  if (!user) return out;
  const requester = { id: user.id, role: user.role } as Requester;
  const idsOf = (type: string) => [...new Set(rows.filter((r) => r.subjectType === type && r.subjectId != null && !gone.has(`${type}:${r.subjectId}`)).map((r) => r.subjectId as number))];

  const oScope = orderScope(requester);
  const orderIds = Object.keys(oScope).length > 0 ? idsOf('order') : [];
  if (orderIds.length) {
    const seen = new Set((await prisma.order.findMany({ where: { id: { in: orderIds }, ...oScope }, select: { id: true } })).map((o) => o.id));
    for (const id of orderIds) if (!seen.has(id)) out.add(`order:${id}`);
  }
  const cScope = customerScope(requester);
  const customerIds = cScope ? idsOf('customer') : [];
  if (cScope && customerIds.length) {
    const seen = new Set((await prisma.customer.findMany({ where: { id: { in: customerIds }, AND: [cScope] }, select: { id: true } })).map((c) => c.id));
    for (const id of customerIds) if (!seen.has(id)) out.add(`customer:${id}`);
  }
  return out;
}

/** Names of the people who caused the rows (one read for the page). A row with no actor, or a removed one, has no name. */
export async function actorNameMap(rows: Notification[]): Promise<Map<number, string>> {
  const ids = [...new Set(rows.map((r) => r.actorId).filter((id): id is number => id != null))];
  if (ids.length === 0) return new Map();
  const people = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
  return new Map(people.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
}

export function present(row: Notification, gone: Set<string>, noAccess: Set<string> = new Set(), actors: Map<number, string> = new Map()) {
  const hasSubject = !!row.subjectType && row.subjectId != null;
  return {
    id: row.id,
    kind: row.kind,
    event: row.type,
    title: row.title,
    message: row.message,
    data: row.data,
    isRead: row.isRead,
    readAt: row.readAt,
    doneAt: row.doneAt,
    snoozedUntil: row.snoozedUntil,
    createdAt: row.createdAt,
    userId: row.userId,
    actorId: row.actorId,
    actorName: row.actorId != null ? actors.get(row.actorId) ?? null : null,
    subject: hasSubject ? { type: row.subjectType, id: row.subjectId } : null,
    subjectDeleted: hasSubject ? gone.has(`${row.subjectType}:${row.subjectId}`) : false,
    /** false: the link is greyed (the item was deleted, or it now belongs to someone else). */
    subjectAccessible: hasSubject ? !gone.has(`${row.subjectType}:${row.subjectId}`) && !noAccess.has(`${row.subjectType}:${row.subjectId}`) : true,
  };
}

/** GET /api/inbox */
export async function listFeed(user: InboxUser, q: FeedQuery, now = new Date()) {
  if (q.scope === 'all' && !isOwnerRole(user.role as never)) throw new AppError('Only the owner can list every row', 403);
  const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const and: Where[] = [];
  if (q.scope === 'mine') and.push({ userId: user.id });
  if (q.view === 'assigned') and.push(await assignedSubjectFilter(user.id));
  else if (q.view !== 'all') and.push({ kind: VIEW_KIND[q.view] });

  if (q.status === 'open') and.push(openWhere(now));
  else if (q.status === 'done') and.push({ doneAt: { not: null } });
  else and.push({ doneAt: null, snoozedUntil: { gt: now } });

  if (q.cursor) {
    const c = decodeCursor(q.cursor);
    and.push({ OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] });
  }

  const rows = await prisma.notification.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const [{ gone, noAccess }, actors] = await Promise.all([
    subjectDeletedMap(page).then(async (deleted) => ({ gone: deleted, noAccess: await subjectNoAccessSet(page, deleted, user) })),
    actorNameMap(page),
  ]);
  return {
    items: page.map((r) => present(r, gone, noAccess, actors)),
    nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]) : null,
  };
}

/**
 * Unread per view, from the database. Open rows only; a snoozed Alert still counts in Alerts (and in All),
 * so a snooze never hides a problem from the count.
 */
export async function getCounts(userId: number, now = new Date()): Promise<InboxCounts> {
  const unreadOpen: Where = {
    userId, isRead: false, doneAt: null,
    OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }, { kind: 'alert' }],
  };
  const [byKind, assignedFilter] = await Promise.all([
    prisma.notification.groupBy({ by: ['kind'], where: unreadOpen, _count: { _all: true } }),
    assignedSubjectFilter(userId),
  ]);
  const assigned = await prisma.notification.count({ where: { AND: [unreadOpen, assignedFilter] } });
  const kindCount = (k: NotificationKind) => byKind.find((b) => b.kind === k)?._count._all ?? 0;
  return {
    all: byKind.reduce((sum, b) => sum + b._count._all, 0),
    alerts: kindCount('alert'),
    replies: kindCount('reply'),
    mentions: kindCount('mention'),
    reminders: kindCount('reminder'),
    notes: kindCount('note'),
    assigned,
  };
}

export interface RowPatch { read?: boolean; done?: boolean; snoozedUntil?: Date | null }

/** PATCH /api/inbox/:id: only the person's own rows. */
export async function patchRow(userId: number, id: number, patch: RowPatch, now = new Date(), role?: string) {
  const row = await prisma.notification.findFirst({ where: { id, userId } });
  if (!row) throw new AppError('Notification not found', 404);
  if (patch.snoozedUntil && patch.snoozedUntil.getTime() <= now.getTime()) {
    throw new AppError('Snooze until a time in the future', 400);
  }
  const data: Prisma.NotificationUpdateInput = {};
  if (patch.read === true) Object.assign(data, { isRead: true, readAt: row.readAt ?? now });
  if (patch.read === false) Object.assign(data, { isRead: false, readAt: null });
  if (patch.done === true) Object.assign(data, { doneAt: now, isRead: true, readAt: row.readAt ?? now, snoozedUntil: null });
  if (patch.done === false) Object.assign(data, { doneAt: null });
  if (patch.snoozedUntil !== undefined) Object.assign(data, { snoozedUntil: patch.snoozedUntil });
  const updated = await prisma.notification.update({ where: { id }, data });
  const gone = await subjectDeletedMap([updated]);
  const [noAccess, actors] = await Promise.all([
    subjectNoAccessSet([updated], gone, role ? { id: userId, role } : undefined),
    actorNameMap([updated]),
  ]);
  return present(updated, gone, noAccess, actors);
}

/** POST /api/inbox/mark-all: marks the person's unread open rows of one view as read. */
export async function markAll(userId: number, view: InboxView, now = new Date()): Promise<number> {
  const and: Where[] = [{ userId, isRead: false, doneAt: null }];
  if (view === 'assigned') and.push(await assignedSubjectFilter(userId));
  else if (view !== 'all') and.push({ kind: VIEW_KIND[view] });
  const { count } = await prisma.notification.updateMany({ where: { AND: and }, data: { isRead: true, readAt: now } });
  return count;
}
