import { ActorKind, OrderStatus } from '@prisma/client';

/**
 * Order timeline builder (F-322). Pure: takes rows already read from the database and returns the rows to show,
 * oldest first. Main rows are the placing and every status move. Small rows are edits, assignments, calls and notes.
 * A planned re-delivery is the last row. Times are ISO strings; the screen shows them in Accra time.
 */

export type TimelineActorKind = 'person' | 'ai_agent' | 'partner' | 'system';

const ACTOR_KIND: Record<ActorKind, TimelineActorKind> = {
  user: 'person',
  ai: 'ai_agent',
  integration: 'partner',
  system: 'system',
};

export interface TimelineActor {
  kind: TimelineActorKind;
  userId: number | null;
  name: string | null;
}

export interface TimelineRow {
  kind: 'placed' | 'status' | 'assignment' | 'edit' | 'call' | 'note' | 'planned';
  size: 'main' | 'small';
  at: string;
  title: string;
  actor: TimelineActor | null;
  note: string | null;
  /** Status rows only. */
  status?: OrderStatus;
  fromStatus?: OrderStatus | null;
  /** True for a forced move: the row shows the reason and the tag "Override". */
  override?: boolean;
  reason?: string | null;
  /** True for an integration jump past the normal table (F-302). */
  jump?: boolean;
  /** "Confirmed after 12 min", "Delivered after 4.1 days". */
  durationChip?: string;
}

export interface TimelineOrder {
  status: OrderStatus;
  createdAt: Date;
  createdById: number | null;
  source: string;
  confirmedAt: Date | null;
  deliveryDate: Date | null;
  nextAttemptDate: Date | null;
}

export interface TimelineHistoryRow {
  status: OrderStatus;
  fromStatus: OrderStatus | null;
  notes: string | null;
  metadata: unknown;
  createdAt: Date;
  changedBy: number | null;
  actorKind: ActorKind | null;
  forced: boolean;
}

export interface TimelineCall {
  outcome: string;
  notes: string | null;
  createdAt: Date;
  salesRepId: number;
}

export interface TimelineEdit {
  createdAt: Date;
  userId: number | null;
  fields: string[];
}

const STATUS_TITLES: Record<OrderStatus, string> = {
  pending_confirmation: 'Waiting for confirmation',
  payment_pending: 'Waiting for payment',
  payment_failed: 'Payment failed',
  confirmed: 'Confirmed',
  preparing: 'Packed',
  ready_for_pickup: 'Ready for pickup',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  digital_delivered: 'Digital delivery sent',
  failed_delivery: 'Failed delivery',
  returned: 'Returned',
  cancelled: 'Cancelled',
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 12 min, 3.5 hours, 4.1 days: the unit that keeps the number small. */
export function formatDuration(ms: number): string {
  const span = Math.max(0, ms);
  if (span < HOUR) return `${Math.max(1, Math.round(span / MINUTE))} min`;
  if (span < DAY) return `${Math.round((span / HOUR) * 10) / 10} hours`;
  return `${Math.round((span / DAY) * 10) / 10} days`;
}

const meta = (m: unknown): Record<string, unknown> => (m && typeof m === 'object' && !Array.isArray(m) ? m as Record<string, unknown> : {});
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export interface TimelineInput {
  order: TimelineOrder;
  history: TimelineHistoryRow[];
  calls: TimelineCall[];
  edits: TimelineEdit[];
  /** Names by user id, for every user the rows point at. */
  names: Map<number, string>;
  now?: Date;
}

export function buildTimeline({ order, history, calls, edits, names, now = new Date() }: TimelineInput): TimelineRow[] {
  const name = (id: number | null) => (id == null ? null : names.get(id) ?? null);
  const person = (id: number | null, kind: ActorKind | null): TimelineActor =>
    ({ kind: kind ? ACTOR_KIND[kind] : id == null ? 'system' : 'person', userId: id, name: name(id) });
  const rows: TimelineRow[] = [];
  const sorted = [...history].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // The first history row with no previous status is the placing of the order: it supplies the actor.
  const placing = sorted.find((h) => h.fromStatus === null && !isAssignment(h));
  rows.push({
    kind: 'placed',
    size: 'main',
    at: order.createdAt.toISOString(),
    title: 'Order placed',
    actor: placing || order.createdById != null ? person(placing?.changedBy ?? order.createdById, placing?.actorKind ?? null) : null,
    note: placing?.notes ?? null,
  });

  let confirmedChipDone = false;
  for (const h of sorted) {
    if (h === placing) continue;
    const m = meta(h.metadata);
    if (isAssignment(h)) {
      rows.push({ kind: 'assignment', size: 'small', at: h.createdAt.toISOString(), title: assignmentTitle(m, name), actor: person(h.changedBy, h.actorKind), note: null });
    } else if (h.fromStatus === null) {
      rows.push({ kind: 'note', size: 'small', at: h.createdAt.toISOString(), title: h.notes ?? 'Order updated', actor: person(h.changedBy, h.actorKind), note: null });
    } else {
      const row: TimelineRow = {
        kind: 'status',
        size: 'main',
        at: h.createdAt.toISOString(),
        title: STATUS_TITLES[h.status],
        actor: person(h.changedBy, h.actorKind),
        note: h.forced ? null : h.notes,
        status: h.status,
        fromStatus: h.fromStatus,
        ...(h.forced && { override: true, reason: typeof m.reason === 'string' ? m.reason : h.notes }),
        ...(m.jump === true && { jump: true }),
      };
      if (h.status === 'confirmed' && !confirmedChipDone) {
        confirmedChipDone = true;
        row.durationChip = `Confirmed after ${formatDuration(h.createdAt.getTime() - order.createdAt.getTime())}`;
      }
      if (h.status === 'delivered' && order.confirmedAt) {
        row.durationChip = `Delivered after ${formatDuration(h.createdAt.getTime() - order.confirmedAt.getTime())}`;
      }
      rows.push(row);
    }
  }

  for (const c of calls) {
    rows.push({ kind: 'call', size: 'small', at: c.createdAt.toISOString(), title: `Call: ${c.outcome.replace(/_/g, ' ')}`, actor: person(c.salesRepId, 'user'), note: c.notes });
  }
  for (const e of edits) {
    rows.push({ kind: 'edit', size: 'small', at: e.createdAt.toISOString(), title: e.fields.length ? `Edited ${e.fields.join(', ')}` : 'Order edited', actor: person(e.userId, 'user'), note: null });
  }

  rows.sort((a, b) => a.at.localeCompare(b.at));

  // A planned re-delivery is a future row from nextAttemptDate.
  if (order.status === 'failed_delivery' && order.nextAttemptDate && order.nextAttemptDate.getTime() > now.getTime()) {
    rows.push({ kind: 'planned', size: 'main', at: order.nextAttemptDate.toISOString(), title: 'Re-delivery planned', actor: null, note: null });
  }
  return rows;
}

/** Assignment rows keep the order's status and write no previous status. */
const isAssignment = (h: TimelineHistoryRow) => {
  const m = meta(h.metadata);
  return h.fromStatus === null && ['assignedRepId', 'assignedAgentId', 'removedRepId', 'removedAgentId', 'agentId'].some((k) => k in m);
};

function assignmentTitle(m: Record<string, unknown>, name: (id: number | null) => string | null): string {
  if ('removedRepId' in m || 'removedAgentId' in m) return 'Call rep and delivery agent removed';
  if ('assignedRepId' in m) return `Call rep set to ${name(num(m.assignedRepId)) ?? 'a teammate'}`;
  return `Delivery agent set to ${name(num(m.assignedAgentId ?? m.agentId)) ?? 'a teammate'}`;
}
