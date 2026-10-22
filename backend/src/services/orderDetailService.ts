import prisma from '../utils/prisma';
import { AppError } from '../middleware/errorHandler';
import { Requester } from '../utils/authUtils';
import { hasPermission } from '../middleware/auth';
import * as Money from '../utils/money';
import { formatOrderNumber } from '../utils/orderNumber';
import { withSoftDeleted } from '../utils/prismaExtensions';
import { actorOf, allowedTransitions, ownsOrder } from './orderStateMachine';
import orderFlagService from './orderFlagService';
import { paymentTagOf } from './orderPaymentTag';
import { buildTimeline, TimelineEdit } from './orderTimeline';

const userName = { select: { id: true, firstName: true, lastName: true } } as const;

/** A missing, deleted or out-of-scope order. A rep or an agent who does not own it gets the same 404 as a missing order. */
function assertVisible<T extends { deletedAt: Date | null; customerRepId: number | null; deliveryAgentId: number | null }>(
  order: T | null,
  requester: Requester,
): T {
  if (!order) throw new AppError('Order not found', 404);
  if (order.deletedAt) throw new AppError('This order was deleted.', 404);
  if (!ownsOrder(order, actorOf(requester))) throw new AppError('Order not found', 404);
  return order;
}

const metaIds = (m: unknown): number[] => {
  if (!m || typeof m !== 'object') return [];
  const r = m as Record<string, unknown>;
  return ['assignedRepId', 'assignedAgentId', 'agentId'].map((k) => r[k]).filter((v): v is number => typeof v === 'number');
};

export const orderDetailService = {
  /**
   * Order detail (F-321, F-323, F-300). The order row keeps the keys the old read-only page used; `items`, `history`,
   * `assignees`, `calls`, `messages`, `flags`, `transitions`, `payment`, `paymentTag` and `displayNumber` are added.
   * `messages` stays empty until the message log is wired to orders (M9).
   */
  async getDetail(orderId: number, requester: Requester) {
    const order = assertVisible(await withSoftDeleted(() => prisma.order.findFirst({ where: { id: orderId }, include: {
      customer: true,
      customerRep: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      deliveryAgent: { select: { id: true, firstName: true, lastName: true, phoneNumber: true, role: true } },
      orderItems: { include: { product: true } },
      orderHistory: { orderBy: { createdAt: 'desc' } },
      delivery: true,
      transaction: true,
      agentCollection: { include: { agent: userName } },
      calls: { orderBy: { createdAt: 'desc' }, include: { salesRep: userName } },
    } })), requester);

    const actor = actorOf(requester);
    const [canForce, canSeeCash, flags] = await Promise.all([
      hasPermission(requester, 'orders', 'force_status'),
      hasPermission(requester, 'financial', 'view'),
      orderFlagService.forOrders([orderId]),
    ]);

    const { agentCollection, calls, ...row } = order;
    const deposit = Money.parse(order.depositPaid).gt(0)
      ? { paid: Money.toApi(order.depositPaid), due: Money.toApi(order.balanceDue) }
      : null;
    // "Cash held by" is a finance figure: it needs financial:view
    const cashHeldBy = !canSeeCash ? undefined
      : order.paymentStatus === 'reconciled' || agentCollection?.status === 'reconciled' ? 'Paid in'
      : agentCollection ? `${agentCollection.agent.firstName} ${agentCollection.agent.lastName}`.trim()
      : 'Nobody yet';

    return {
      ...row,
      displayNumber: formatOrderNumber(order.id),
      items: order.orderItems,
      history: order.orderHistory,
      assignees: { customerRep: order.customerRep, deliveryAgent: order.deliveryAgent },
      calls,
      messages: [] as unknown[],
      flags: flags.get(orderId) ?? [],
      transitions: { status: order.status, ...allowedTransitions(order, actor, { canForce }) },
      paymentTag: paymentTagOf(order),
      payment: {
        method: order.paymentMethod,
        status: order.paymentStatus,
        amount: Money.toApi(order.totalAmount),
        deposit,
        ...(canSeeCash && { cashHeldBy }),
      },
    };
  },

  /** Timeline (F-322): history rows, calls and edits of one order, oldest first, with a planned re-delivery last. */
  async getTimeline(orderId: number, requester: Requester) {
    const order = assertVisible(await withSoftDeleted(() => prisma.order.findFirst({ where: { id: orderId }, include: {
      orderHistory: { orderBy: { createdAt: 'asc' } },
      calls: { orderBy: { createdAt: 'asc' } },
    } })), requester);
    const audits = await prisma.auditLog.findMany({
      where: { resource: 'order', resourceId: String(orderId), action: 'update_order' },
      orderBy: { createdAt: 'asc' },
    });
    const edits: TimelineEdit[] = audits.map((a) => {
      const fields = (a.metadata as { fields?: unknown } | null)?.fields;
      return { createdAt: a.createdAt, userId: a.userId, fields: Array.isArray(fields) ? fields.filter((f): f is string => typeof f === 'string') : [] };
    });

    const ids = new Set<number>();
    const add = (id: number | null | undefined) => { if (id != null) ids.add(id); };
    add(order.createdById);
    order.orderHistory.forEach((h) => { add(h.changedBy); metaIds(h.metadata).forEach(add); });
    order.calls.forEach((c) => add(c.salesRepId));
    edits.forEach((e) => add(e.userId));
    const users = ids.size ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, firstName: true, lastName: true } }) : [];
    const names = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

    return buildTimeline({ order, history: order.orderHistory, calls: order.calls, edits, names });
  },
};

export default orderDetailService;
