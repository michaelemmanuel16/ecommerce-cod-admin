import { OrderStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { getSocketInstance } from '../utils/socketInstance';
import { emitNotification } from '../sockets';
import { getTenantId, resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { HUMAN_USERS_WHERE } from './systemUserService';


export async function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  data?: any
) {
  const id = parseInt(userId, 10);
  // The request/job tenant first; only a context-less caller (unscoped run) looks the user up
  const tenantId = getTenantId()
    ?? (await prisma.user.findUnique({ where: { id }, select: { tenantId: true } }))?.tenantId;
  const notification = await prisma.notification.create({
    data: {
      tenantId: resolveTenantId(tenantId),
      userId: id,
      type,
      title,
      message,
      data: data || {},
    }
  });

  // Emit real-time notification via Socket.io
  emitNotification(getSocketInstance() as any, userId, notification);

  return notification;
}

export async function notifyOrderAssigned(
  userId: string,
  orderId: string,
  orderNumber: string,
  role: string
) {
  return createNotification(
    userId,
    'order',
    'New Order Assigned',
    `You have been assigned to order ${orderNumber} as ${role}`,
    { orderId, orderNumber, role }
  );
}

export async function notifyLateCallback(
  userId: string | number,
  orderId: string | number,
  orderNumber: string,
  callbackAt: Date | string,
  customerName?: string,
  callId?: number
) {
  const cbStr = typeof callbackAt === 'string' ? callbackAt : callbackAt.toISOString();
  return createNotification(
    String(userId),
    'late_callback',
    'Late Call-Back',
    `Call-back time passed for order ${orderNumber}. The order is still open.`,
    {
      orderId: Number(orderId),
      orderNumber: String(orderNumber),
      callbackAt: cbStr,
      customerName,
      callId,
    }
  );
}

/** Check for late callbacks (callbackAt in past, order still open) and notify assigned reps. */
export async function checkAndNotifyLateCallbacks(tenantId?: string): Promise<number> {
  const resolvedTenant = resolveTenantId(tenantId);
  const now = new Date();
  const CLOSED_STATUSES: OrderStatus[] = ['delivered', 'digital_delivered', 'returned', 'cancelled'];

  const openOrders = await prisma.order.findMany({
    where: {
      tenantId: resolvedTenant,
      deletedAt: null,
      status: { notIn: CLOSED_STATUSES },
      calls: { some: {} },
    },
    select: {
      id: true,
      customerRepId: true,
      customer: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
      calls: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: {
          id: true,
          outcome: true,
          callbackAt: true,
          salesRepId: true,
        },
      },
    },
  });

  let count = 0;
  for (const order of openOrders) {
    const latestCall = order.calls[0];
    if (!latestCall) continue;
    if (latestCall.outcome !== 'call_back_later') continue;
    if (!latestCall.callbackAt || latestCall.callbackAt >= now) continue;

    const targetUserId = order.customerRepId ?? latestCall.salesRepId;
    if (!targetUserId) continue;

    const existing = await prisma.notification.findFirst({
      where: {
        userId: targetUserId,
        type: 'late_callback',
        data: { path: ['callId'], equals: latestCall.id },
      },
    });

    if (!existing) {
      await notifyLateCallback(
        targetUserId,
        order.id,
        String(order.id),
        latestCall.callbackAt,
        order.customer ? `${order.customer.firstName} ${order.customer.lastName}`.trim() : undefined,
        latestCall.id
      );
      count++;
    }
  }
  return count;
}

/** Admins of the current tenant only (the scoped query adds tenantId); not the system user. */
export const findTenantAdmins = () => prisma.user.findMany({
  where: { role: { in: ['admin', 'super_admin'] }, isActive: true, ...HUMAN_USERS_WHERE },
  select: { id: true }
});

export async function notifyAdminsOverdueCollections(
  agents: { agentId: number; agentName: string; totalBalance: Money.Money; warningAmount: Money.Money; criticalAmount: Money.Money }[]
) {
  if (agents.length === 0) return;

  // Admins of the current tenant only (the scoped query adds tenantId).
  // Callers run this once per tenant.
  const admins = await findTenantAdmins();

  const agentSummary = agents
    .map(a => `${a.agentName}: GHS ${Money.toApi(a.totalBalance)} (${a.criticalAmount.gt(0) ? '8+ days' : '4-7 days'})`)
    .join(', ');

  const totalOverdue = Money.sum(agents.map(a => a.totalBalance));

  const message = `${agents.length} agent(s) have overdue collections totaling GHS ${Money.toApi(totalOverdue)}: ${agentSummary}`;
  const data = {
    agents: agents.map(a => ({
      ...a,
      totalBalance: Money.toApi(a.totalBalance),
      warningAmount: Money.toApi(a.warningAmount),
      criticalAmount: Money.toApi(a.criticalAmount)
    })),
    totalOverdue: Money.toApi(totalOverdue)
  };

  for (const admin of admins) {
    // The job runs daily: refresh the admin's unread alert instead of adding a copy each day (COD-148)
    const unread = await prisma.notification.findFirst({
      where: { userId: admin.id, type: 'overdue_collections', isRead: false },
      select: { id: true }
    });
    if (unread) {
      const notification = await prisma.notification.update({
        where: { id: unread.id },
        data: { message, data, createdAt: new Date() }
      });
      emitNotification(getSocketInstance() as any, admin.id.toString(), notification);
    } else {
      await createNotification(admin.id.toString(), 'overdue_collections', 'Overdue Agent Collections', message, data);
    }
  }
}

export async function notifyAgentBlocked(
  userId: string,
  reason: string
) {
  return createNotification(
    userId,
    'agent_blocked',
    'Account Blocked',
    `Your account has been blocked: ${reason}`,
    { reason }
  );
}

export async function notifyAgentUnblocked(
  userId: string
) {
  return createNotification(
    userId,
    'agent_unblocked',
    'Account Unblocked',
    'Your account has been unblocked. You can now receive new deliveries.',
    {}
  );
}

/** One "nobody can take this order" alert per scope per hour, so a busy queue does not flood the inbox (F-1162). */
const NO_ASSIGNEE_ALERT_WINDOW_MS = 60 * 60 * 1000;

export async function notifyAdminsNoAssigneeAvailable(scope: string, role: string, noun: string) {
  const since = new Date(Date.now() - NO_ASSIGNEE_ALERT_WINDOW_MS);
  const recent = await prisma.notification.findFirst({
    where: { type: 'no_assignee_available', createdAt: { gte: since }, data: { path: ['scope'], equals: scope } },
    select: { id: true }
  });
  if (recent) return;
  for (const admin of await findTenantAdmins()) {
    await createNotification(
      admin.id.toString(),
      'no_assignee_available',
      `No ${noun} is available`,
      `New orders are waiting: every ${noun} is unavailable or away. Set someone to available so orders can be assigned.`,
      { scope, role }
    );
  }
}

export { checkQueueWaitAlerts, notifyQueueWaitAlert } from './queueAlertService';
