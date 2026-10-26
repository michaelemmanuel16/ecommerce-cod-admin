import { OrderStatus } from '@prisma/client';
import { TransactionClient } from '../utils/prisma';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { getSystemUserId } from './systemUserService';
import * as Money from '../utils/money';
import { GLAutomationService, ORDER_GL_INCLUDE } from './glAutomationService';
import { enqueueOrderFinancialSync } from '../queues/financialReconciliationQueue';
import { getSocketInstance } from '../utils/socketInstance';
import { emitOrderUpdated, emitOrderStatusChanged, emitGLEntryCreated } from '../sockets';
import { AppEvent, OrderStatusChangedEvent, emitOrderEvent } from '../utils/appEvents';

/**
 * Side effects of a status move (M1-T10), called by the state machine in the move's transaction.
 * GL: revenue on entering delivered, reversal on leaving delivered, fee per failed attempt.
 * Everything here is idempotent. Stock moves in stockService, called by the state machine (M4-T07).
 */

/** Same shape the order status endpoint returns and the socket events carry. */
export const ORDER_EVENT_INCLUDE = {
  customer: { select: { id: true, firstName: true, lastName: true, phoneNumber: true, alternatePhone: true, email: true } },
  customerRep: { select: { id: true, firstName: true, lastName: true, email: true, role: true, commissionAmount: true } },
  deliveryAgent: { select: { id: true, firstName: true, lastName: true, phoneNumber: true, role: true, commissionAmount: true } },
  orderItems: { include: { product: { select: { id: true, name: true, sku: true, cogs: true } } } },
} as const;

export interface GlEffects {
  /** Reversal entry posted by this move, for the `gl_entry_created` socket event. */
  reversal?: any;
  /** Revenue entry on entering delivered (an existing active entry when this move posted nothing new). */
  revenue?: any;
  /** The order (items with products, agent, rep) as read for the revenue entry, so a caller needs no second read. */
  revenueOrder?: any;
  /** Failed-attempt fee entry; none when the agent has no FeeRule. */
  failedFee?: any;
}

/**
 * Revenue entry on entering delivered (dated `deliveryDate`). `createRevenueRecognitionEntry` posts only
 * when the order has no ACTIVE revenue entry (not voided, not reversed), so a repeat posts nothing and a
 * re-delivery after a return posts again (D7). Only COD orders post, as the post-delivery sync always did,
 * unless `always` (completeDelivery, D14).
 */
async function postRevenue(
  tx: TransactionClient, orderId: number, userId: number, always = false,
): Promise<{ entry: any; order: any } | undefined> {
  const order: any = await tx.order.findFirst({ where: { id: orderId }, include: ORDER_GL_INCLUDE });
  // D14: `always` is completeDelivery's rule (posts whatever the codAmount); the status path posts COD orders only.
  if (!order || (!always && !Money.isNonZero(order.codAmount))) return undefined;

  const entry = await GLAutomationService.createRevenueRecognitionEntry(
    tx as any,
    order,
    GLAutomationService.cogsOfOrder(order),
    userId,
  );
  // completeDelivery (`always`) books its own cash collection, so the flag is set with the entry link. The
  // status path leaves it false: the queued financial sync skips an order that is already flagged, and it
  // creates the COD collection and the agent collection.
  const flag = always && !order.revenueRecognized;
  if (order.glJournalEntryId !== entry.id || flag) {
    await tx.order.update({
      where: { id: orderId },
      data: { glJournalEntryId: entry.id, ...(flag ? { revenueRecognized: true } : {}) },
    });
  }
  return { entry, order };
}

/**
 * Reversal on leaving delivered. One reversal per revenue entry: `createReturnReversalEntry` links the
 * original to its reversal through `JournalEntry.reversingEntryId`, so the order has no active revenue
 * entry afterwards. Dated `returnedAt` for a return, the move time for a forced move elsewhere.
 */
async function reverseRevenue(
  tx: TransactionClient, orderId: number, to: OrderStatus, userId: number,
): Promise<any | undefined> {
  const active: any = await GLAutomationService.findActiveRevenueEntry(tx as any, orderId);
  if (!active) return undefined;

  const order: any = await tx.order.findFirst({ where: { id: orderId }, include: ORDER_GL_INCLUDE });
  if (!order) return undefined;

  const reversal = await GLAutomationService.createReturnReversalEntry(
    tx as any, order, active, userId, undefined,
    to === 'returned' ? (order.returnedAt ?? new Date()) : new Date(),
  );
  await tx.order.update({ where: { id: orderId }, data: { revenueRecognized: false } });
  return reversal;
}

/** GL posting for one move, in the move's transaction. */
export async function applyGlEffects(
  tx: TransactionClient,
  order: { id: number; tenantId?: string | null; deliveryAgentId?: number | null },
  from: OrderStatus,
  to: OrderStatus,
  userId: number | undefined,
  historyId: number,
  opts: { postRevenueAlways?: boolean } = {},
): Promise<GlEffects> {
  // Only a move that posts to the ledger needs an actor, so look it up lazily.
  const actor = async () => userId ?? await getSystemUserId();
  const effects: GlEffects = {};
  if (from === 'delivered') effects.reversal = await reverseRevenue(tx, order.id, to, await actor());
  if (to === 'delivered') {
    const posted = await postRevenue(tx, order.id, await actor(), opts.postRevenueAlways);
    effects.revenue = posted?.entry;
    effects.revenueOrder = posted?.order;
  }
  if (to === 'failed_delivery') effects.failedFee = (await GLAutomationService.createFailedAttemptEntry(tx as any, order, historyId, await actor())) ?? undefined;
  return effects;
}

/**
 * After the move commits: queue the financial sync, emit the socket events, emit `order.status_changed`
 * (the workflow service listens, M2-T17). Event names and payloads are the ones updateOrderStatus always sent. Never throws.
 */
export function afterCommitEffects(
  orderId: number, from: OrderStatus, to: OrderStatus, userId: number | undefined, gl: GlEffects,
  statusChanged: OrderStatusChangedEvent,
): void {
  setImmediate(async () => {
    try {
      const updated: any = await prisma.order.findFirst({ where: { id: orderId }, include: ORDER_EVENT_INCLUDE });
      if (!updated) return;

      if (to === 'delivered' && Money.isNonZero(updated.codAmount)) {
        await enqueueOrderFinancialSync(orderId, updated.tenantId, userId);
      }

      const ioInstance = getSocketInstance() as any;
      emitOrderUpdated(ioInstance, updated);
      emitOrderStatusChanged(ioInstance, updated, from, to);
      if (gl.reversal) {
        emitGLEntryCreated(ioInstance, gl.reversal, {
          orderId, orderNumber: orderId.toString(), type: 'return_reversal',
        });
      }
    } catch (error) {
      logger.error('Failed to run post-commit order effects', { orderId, error });
    }
    emitOrderEvent(AppEvent.ORDER_STATUS_CHANGED, statusChanged);
  });
}
