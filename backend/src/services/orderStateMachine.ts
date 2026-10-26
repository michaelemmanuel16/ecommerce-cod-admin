import { ActorKind, DeclineReason, FailureReason, OrderStatus, PaymentStatus, Prisma, UserRole } from '@prisma/client';
import prisma, { TransactionClient } from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { hasPermission } from '../middleware/auth';
import { resolveTenantId } from '../utils/tenantContext';
import { Requester } from '../utils/authUtils';
import { OrderStatusChangedEvent } from '../utils/appEvents';
import { afterCommitEffects, applyGlEffects, GlEffects } from './orderSideEffects';
import { fulfilOrder, reverseOrder } from './stockService';
import { recordDeliveryAttempt } from './deliveryAttemptHook';
import { stampDeliveryFee } from './feeRuleService';

/**
 * Order state machine (F-301, F-302). `transitionOrder` is the one function that writes Order.status.
 * One transition table, one optimistic lock on statusVersion, one OrderHistory row per move.
 */

type TransitionErrorCode =
  | 'INVALID_TRANSITION'
  | 'STALE_ORDER'
  | 'FORBIDDEN'
  | 'REASON_REQUIRED'
  | 'COLLECTION_VERIFIED';

const ERROR_STATUS: Record<TransitionErrorCode, number> = {
  INVALID_TRANSITION: 409,
  STALE_ORDER: 409,
  FORBIDDEN: 403,
  REASON_REQUIRED: 400,
  COLLECTION_VERIFIED: 409,
};

/**
 * AppError subclass: the existing error middleware answers with `code`, the HTTP status and `details`
 * (`from`, `to`, and `allowed` once `transitionOrder` has filled it: the normal moves the actor could make, M1-T12).
 */
export class OrderTransitionError extends AppError {
  code: TransitionErrorCode;

  constructor(code: TransitionErrorCode, message: string, detail: { from?: OrderStatus; to?: OrderStatus } = {}) {
    super(message, ERROR_STATUS[code], code);
    this.name = 'OrderTransitionError';
    this.code = code;
    this.details = { from: detail.from, to: detail.to };
  }

  setAllowed(allowed: OrderStatus[]): this {
    this.details = { ...this.details, allowed };
    return this;
  }
}

export interface TransitionActor {
  kind: ActorKind;
  userId?: number;
  role?: UserRole;
}

/** The actor behind a request: a signed-in user, else the system (scripts, tests, service calls). */
export function actorOf(requester?: Requester, changedBy?: number): TransitionActor {
  return requester
    ? { kind: 'user', userId: requester.id, role: requester.role }
    : { kind: 'system', userId: changedBy };
}

export interface TransitionOptions {
  note?: string;
  force?: boolean;
  reason?: string;
  declineReason?: DeclineReason;
  failureReason?: FailureReason;
  nextAttemptDate?: Date | null;
  deliveryDate?: Date;
  /** Set with the move (updateOrderStatus and completeDelivery write `collected` on delivered). */
  paymentStatus?: PaymentStatus;
  /** D14: completeDelivery posts revenue even when codAmount is 0 (the status path posts only COD orders). */
  postRevenueAlways?: boolean;
  metadata?: Record<string, unknown>;
  /** M2-T17: override the workflow skip rules (imports, backdated integration moves). */
  runWorkflows?: boolean;
  /** M2-T17: the move comes from a bulk import re-import; workflows skip it unless `runWorkflows`. */
  imported?: boolean;
  /** M2-T17: loop guard depth. A workflow's `update_order` passes the depth of the run that caused it, plus one. */
  workflowDepth?: number;
  tx?: TransactionClient;
}

export interface TransitionResult {
  changed: boolean;
  from: OrderStatus;
  forced?: boolean;
  jump?: boolean;
  /** GL entries this move posted (revenue, reversal, failed-attempt fee). */
  gl?: GlEffects;
  /**
   * Queues the financial sync, emits the socket events and emits `order.status_changed` (workflows listen). Runs by itself
   * after commit when transitionOrder owns the transaction. A caller that passes `options.tx` must
   * call it once, after its own commit.
   */
  afterCommit?: () => void;
}

/** The 12 order statuses, in schema order. GET /api/orders/statuses returns this list. */
export const ALL_STATUSES = Object.values(OrderStatus);

const PRE_DISPATCH: OrderStatus[] = ['confirmed', 'preparing', 'ready_for_pickup'];
const isPreDispatch = (s: OrderStatus) => PRE_DISPATCH.includes(s);

const preDispatchTargets = (self: OrderStatus): OrderStatus[] => [
  ...PRE_DISPATCH.filter((s) => s !== self), 'out_for_delivery', 'cancelled',
];

/**
 * F-301 normal transitions. A pre-dispatch state may also go to `digital_delivered`; that move is
 * not in this table because it depends on the order type and the actor (see `tableAllows`).
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_confirmation: ['confirmed', 'cancelled', 'payment_pending'],
  payment_pending: ['confirmed', 'digital_delivered', 'payment_failed', 'cancelled'],
  payment_failed: ['payment_pending', 'cancelled'],
  confirmed: preDispatchTargets('confirmed'),
  preparing: preDispatchTargets('preparing'),
  ready_for_pickup: preDispatchTargets('ready_for_pickup'),
  out_for_delivery: ['delivered', 'failed_delivery', 'returned'],
  delivered: ['returned'],
  digital_delivered: [],
  failed_delivery: ['out_for_delivery', 'returned', 'cancelled'],
  returned: [],
  cancelled: [],
};

const isDigital = (order: { orderType?: string | null }) => order.orderType === 'digital';

/** Statuses only a digital order uses (COD-139). */
const PAYMENT_STATUSES: OrderStatus[] = ['digital_delivered', 'payment_pending', 'payment_failed'];

/** Is `from -> to` in the F-301 table for this order? */
function tableAllows(order: { orderType?: string | null }, from: OrderStatus, to: OrderStatus): boolean {
  if (TRANSITIONS[from].includes(to)) return true;
  return isPreDispatch(from) && to === 'digital_delivered' && isDigital(order);
}

/**
 * Integration jumps (F-302, widened by decision D1 in docs/plan/M1-decisions.md): a 3PL feed
 * (Logiswift sync via MCP) reports where the parcel really is, so an integration actor may make
 * any move outside the table, with no reason. Each one is flagged `metadata.jump`.
 * Real 60-day moves this covers: pending_confirmation -> out_for_delivery (1,223),
 * out_for_delivery -> cancelled (120), cancelled -> delivered. digital_delivered stays system only
 * (so a jump is any move to a status other than digital_delivered).
 */
const isMachineActor = (actor: TransitionActor) => actor.kind === 'integration' || actor.kind === 'ai';

type OrderLike = {
  orderType?: string | null;
  customerRepId?: number | null;
  deliveryAgentId?: number | null;
};

/** D13: a rep owns an order when customerRepId is the rep, an agent when deliveryAgentId is the agent. */
const ownsAsRep = (order: OrderLike, actor: TransitionActor) => actor.userId != null && order.customerRepId === actor.userId;
const ownsAsAgent = (order: OrderLike, actor: TransitionActor) => actor.userId != null && order.deliveryAgentId === actor.userId;

/** D13 ownership gate: false only for a rep or an agent who does not own the order. Other roles pass. */
export const ownsOrder = (order: OrderLike, actor: TransitionActor) =>
  !((actor.role === 'sales_rep' && !ownsAsRep(order, actor)) || (actor.role === 'delivery_agent' && !ownsAsAgent(order, actor)));

/** Role gate for a move that is already in the table. */
function roleAllows(order: OrderLike, actor: TransitionActor, from: OrderStatus, to: OrderStatus): boolean {
  if (actor.kind === 'system') return true;
  if (to === 'digital_delivered' && isPreDispatch(from)) return false; // system only
  if (isMachineActor(actor)) return true;

  const role = actor.role;
  switch (role) {
    case 'super_admin':
    case 'admin':
    case 'manager':
      return true;
    case 'sales_rep':
      return from === 'pending_confirmation' && (to === 'confirmed' || to === 'cancelled') && ownsAsRep(order, actor);
    case 'inventory_manager':
      return isPreDispatch(from) && isPreDispatch(to);
    case 'delivery_agent': {
      if (!ownsAsAgent(order, actor)) return false;
      return (isPreDispatch(from) && to === 'out_for_delivery')
        || (from === 'out_for_delivery' && (to === 'delivered' || to === 'failed_delivery'))
        || (from === 'failed_delivery' && to === 'out_for_delivery');
    }
    default:
      return false; // accountant and unknown roles
  }
}

/**
 * Moves the actor can make now. `normal` are the plain moves (including integration jumps);
 * `forced` are every other distinct status, only when `canForce` (orders:force_status).
 * Used by GET /api/orders/:id/transitions.
 */
export function allowedTransitions(
  order: OrderLike & { status: OrderStatus },
  actor: TransitionActor,
  opts: { canForce?: boolean } = {},
): { normal: OrderStatus[]; forced: OrderStatus[] } {
  const from = order.status;
  // COD-139: a physical order is never offered the digital and payment statuses, unless it already sits in one.
  const hidden = isDigital(order) || PAYMENT_STATUSES.includes(from) ? [] : PAYMENT_STATUSES;
  const offered = (to: OrderStatus) => to !== from && !hidden.includes(to) && (to !== 'digital_delivered' || isDigital(order));
  const normal = ALL_STATUSES.filter((to) => {
    if (!offered(to)) return false;
    if (tableAllows(order, from, to)) return roleAllows(order, actor, from, to);
    return isMachineActor(actor) && to !== 'digital_delivered';
  });
  const forced = opts.canForce && actor.kind === 'user'
    ? ALL_STATUSES.filter((to) => offered(to) && !normal.includes(to))
    : [];
  return { normal, forced };
}

const label = (s: OrderStatus) => s.replace(/_/g, ' ');

function invalidTransition(from: OrderStatus, to: OrderStatus): OrderTransitionError {
  const targets = TRANSITIONS[from];
  const message = targets.length === 0
    ? `An order that is ${label(from)} cannot be moved to another status.`
    : `An order that is ${label(from)} cannot move to ${label(to)}. It can only move to ${targets.map(label).join(', ')}.`;
  return new OrderTransitionError('INVALID_TRANSITION', message, { from, to });
}

/** Collection statuses at or after `verified`. A delivered order in one of them cannot be reopened. */
const COLLECTION_LOCKED = ['verified', 'approved', 'deposited', 'reconciled'] as const;

type SideEffectOrder = {
  id: number; tenantId?: string | null; deliveryAgentId?: number | null;
  confirmedAt?: Date | null; confirmedById?: number | null; dispatchedAt?: Date | null;
};

/** Order fields a move sets with its status: lifecycle timestamps and reason fields. Written in the lock update. */
function moveFields(
  order: SideEffectOrder,
  from: OrderStatus,
  to: OrderStatus,
  actor: TransitionActor,
  options: TransitionOptions,
): Prisma.OrderUncheckedUpdateManyInput {
  const now = new Date();
  const data: Prisma.OrderUncheckedUpdateManyInput = {};

  if (to === 'confirmed' && !order.confirmedAt) {
    data.confirmedAt = now;
    if (!order.confirmedById && actor.userId != null) data.confirmedById = actor.userId;
  }
  if (to === 'out_for_delivery' && !order.dispatchedAt) data.dispatchedAt = now;
  // A jump to delivered never saw out_for_delivery: dispatch time is the move time (F-302).
  if (to === 'delivered' && options.metadata?.jump === true && !order.dispatchedAt) data.dispatchedAt = now;
  if (to === 'returned') data.returnedAt = now;

  if (to === 'delivered' || (to === 'digital_delivered' && options.deliveryDate)) data.deliveryDate = options.deliveryDate ?? now;
  else if (from === 'delivered') data.deliveryDate = null;

  if (options.paymentStatus) data.paymentStatus = options.paymentStatus;

  if (options.declineReason !== undefined) data.declineReason = options.declineReason;
  if (options.failureReason !== undefined) data.failureReason = options.failureReason;
  else if (to === 'out_for_delivery') data.failureReason = null;
  if (options.nextAttemptDate !== undefined) data.nextAttemptDate = options.nextAttemptDate;
  else if (to === 'failed_delivery' && options.failureReason === 'rescheduled') {
    // A reschedule with no date tries again tomorrow (D3).
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    data.nextAttemptDate = tomorrow;
  }
  return data;
}

/** The date an outcome happened: the delivery date, the return time, or now for a failed attempt (F-703). */
const outcomeDate = (to: OrderStatus, fields: Prisma.OrderUncheckedUpdateManyInput): Date =>
  ((to === 'delivered' ? fields.deliveryDate : to === 'returned' ? fields.returnedAt : undefined) as Date | undefined) ?? new Date();

/** Side effects of a move, in the move's transaction: stock (F-657, one call site), the delivery fee stamp (F-703) and GL posting. */
async function applySideEffects(
  tx: TransactionClient,
  order: SideEffectOrder & { totalAmount: Prisma.Decimal },
  from: OrderStatus,
  to: OrderStatus,
  actor: TransitionActor,
  options: TransitionOptions,
  historyId: number,
  fields: Prisma.OrderUncheckedUpdateManyInput,
): Promise<GlEffects> {
  if (to === 'delivered') await fulfilOrder(tx, order, actor.userId);
  else if (from === 'delivered') await reverseOrder(tx, order, actor.userId);
  // The fee is stamped before the entries post, so the revenue read and the collection amount see it.
  const on = outcomeDate(to, fields);
  const stamped = await stampDeliveryFee(tx, order, from, to, on);
  return applyGlEffects(tx, order, from, to, actor.userId, historyId, { postRevenueAlways: options.postRevenueAlways, fee: stamped && { ...stamped, on } });
}

/**
 * Move an order to `to`. Same status is a no-op. Errors are OrderTransitionError.
 * Own-store dispatch (F-305) arrives with stores; until then out_for_delivery always needs an agent.
 */
export async function transitionOrder(
  orderId: number,
  to: OrderStatus,
  actor: TransitionActor,
  options: TransitionOptions = {},
): Promise<TransitionResult> {
  if (options.tx) return run(options.tx, orderId, to, actor, options);
  const result = await prisma.$transaction((tx) => run(tx, orderId, to, actor, options));
  result.afterCommit?.();
  return result;
}

async function run(
  tx: TransactionClient,
  orderId: number,
  to: OrderStatus,
  actor: TransitionActor,
  options: TransitionOptions,
): Promise<TransitionResult> {
  const order: any = await tx.order.findFirst({ where: { id: orderId, deletedAt: null } });
  if (!order) throw new AppError('Order not found', 404);

  try {
    return await move(tx, order, to, actor, options);
  } catch (err) {
    if (err instanceof OrderTransitionError && !err.details?.allowed) {
      err.setAllowed(allowedTransitions(order, actor).normal);
    }
    throw err;
  }
}

async function move(
  tx: TransactionClient,
  order: any,
  to: OrderStatus,
  actor: TransitionActor,
  options: TransitionOptions,
): Promise<TransitionResult> {
  const orderId: number = order.id;
  const from: OrderStatus = order.status;
  if (from === to) return { changed: false, from };

  const meta: Record<string, unknown> = { ...(options.metadata ?? {}) };
  let forced = false;
  let jump = false;
  let reason: string | undefined;

  if (options.force) {
    if (actor.kind !== 'user' || actor.userId == null || !actor.role
      || !(await hasPermission({ id: actor.userId, role: actor.role }, 'orders', 'force_status'))) {
      throw new OrderTransitionError('FORBIDDEN', 'You do not have permission to override the order status.', { from, to });
    }
    // A rep or an agent with force_status can force only an order they own (D13); other roles keep the permission check.
    if (!ownsOrder(order, actor)) {
      throw new OrderTransitionError('FORBIDDEN', 'You can only override the status of your own orders.', { from, to });
    }
    // COD-139: the reason is optional. A blank one stores no reason; the forced flag stays on the history row.
    reason = (options.reason ?? '').trim() || undefined;
    if (to === 'digital_delivered' && !isDigital(order)) {
      throw new OrderTransitionError('INVALID_TRANSITION', 'Only a digital order can move to digital delivered.', { from, to });
    }
    if (to === 'delivered' && !order.deliveryAgentId) {
      throw new OrderTransitionError('INVALID_TRANSITION', 'Assign a delivery partner first', { from, to });
    }
    forced = true;
    if (reason) meta.reason = reason;
  } else if (tableAllows(order, from, to)) {
    if (!roleAllows(order, actor, from, to)) {
      throw new OrderTransitionError('FORBIDDEN', 'You cannot make this status change.', { from, to });
    }
    if (isPreDispatch(from) && to === 'out_for_delivery' && !order.deliveryAgentId) {
      throw new OrderTransitionError('INVALID_TRANSITION', 'Assign a delivery agent first', { from, to });
    }
  } else if (isMachineActor(actor) && to !== 'digital_delivered') {
    jump = true;
    meta.jump = true;
  } else if (isPreDispatch(from) && to === 'digital_delivered' && !isDigital(order)) {
    throw new OrderTransitionError('INVALID_TRANSITION', 'Only a digital order can move to digital delivered.', { from, to });
  } else {
    throw invalidTransition(from, to);
  }

  if (from === 'delivered') {
    const collection = await tx.agentCollection.findFirst({ where: { orderId }, select: { status: true } });
    if (collection && (COLLECTION_LOCKED as readonly string[]).includes(collection.status)) {
      throw new OrderTransitionError('COLLECTION_VERIFIED', 'Reverse the collection first', { from, to });
    }
  }

  const fields = moveFields(order, from, to, actor, { ...options, metadata: meta });
  const locked = await tx.order.updateMany({
    where: { id: orderId, statusVersion: order.statusVersion },
    data: { status: to, ...fields },
  });
  if (locked.count === 0) {
    throw new OrderTransitionError('STALE_ORDER', 'This order was changed by someone else. Reload and try again.', { from, to });
  }

  const tenantId = resolveTenantId(order.tenantId);
  const history = await tx.orderHistory.create({
    data: {
      tenantId,
      orderId,
      status: to,
      fromStatus: from,
      changedBy: actor.userId ?? null,
      actorKind: actor.kind,
      notes: options.note ?? reason ?? null,
      forced,
      metadata: meta as Prisma.InputJsonObject,
    },
  });

  if (forced) {
    await tx.auditLog.create({
      data: {
        tenantId,
        userId: actor.userId ?? null,
        action: 'force_status',
        resource: 'order',
        resourceId: String(orderId),
        metadata: { from, to, reason, forced: true },
      },
    });
  }

  const gl = await applySideEffects(tx, order, from, to, actor, options, history.id, fields);
  await recordDeliveryAttempt(tx, order, to, options);

  const statusChanged: OrderStatusChangedEvent = {
    orderId, tenantId, customerId: order.customerId, from, to,
    actor: { kind: actor.kind, userId: actor.userId },
    depth: options.workflowDepth ?? 0,
    deliveryDate: fields.deliveryDate !== undefined ? (fields.deliveryDate as Date | null) : order.deliveryDate,
    imported: options.imported,
    runWorkflows: options.runWorkflows,
  };
  const afterCommit = () => afterCommitEffects(orderId, from, to, actor.userId, gl, statusChanged);
  return { changed: true, from, forced, jump, gl, afterCommit };
}
