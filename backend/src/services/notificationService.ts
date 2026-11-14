import { OrderStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { fullName } from '../utils/nameUtils';
import { notify, findTenantAdmins } from './inbox/inboxService';

export { findTenantAdmins };


export async function notifyLateCallback(
  userId: string | number,
  orderId: string | number,
  orderNumber: string,
  callbackAt: Date | string,
  customerName?: string,
  callId?: number
) {
  const cbStr = typeof callbackAt === 'string' ? callbackAt : callbackAt.toISOString();
  return notify({
    tenantId: resolveTenantId(),
    event: 'late_callback',
    subject: { type: 'order', id: Number(orderId) },
    recipients: [Number(userId)],
    title: 'Late Call-Back',
    message: `Call-back time passed for order ${orderNumber}. The order is still open.`,
    data: {
      orderId: Number(orderId),
      orderNumber: String(orderNumber),
      callbackAt: cbStr,
      customerName,
      callId,
    },
  });
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
      calls: { some: { callbackAt: { lt: now }, outcome: 'call_back_later' } },
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
        order.customer ? fullName(order.customer) || undefined : undefined,
        latestCall.id
      );
      count++;
    }
  }
  return count;
}

export async function notifyAdminsOverdueCollections(
  agents: { agentId: number; agentName: string; totalBalance: Money.Money; warningAmount: Money.Money; criticalAmount: Money.Money }[]
) {
  if (agents.length === 0) return;

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

  // The job runs daily: refresh the owner's unread alert instead of adding a copy each day (COD-148).
  // Callers run this once per tenant.
  await notify({
    tenantId: resolveTenantId(),
    event: 'overdue_collections',
    recipients: 'owner',
    title: 'Overdue Agent Collections',
    message,
    data,
    refreshUnread: true,
  });
}

export async function notifyAgentBlocked(
  userId: string,
  reason: string
) {
  return notify({
    tenantId: resolveTenantId(),
    event: 'agent_blocked',
    recipients: [Number(userId)],
    title: 'Account Blocked',
    message: `Your account has been blocked: ${reason}`,
    data: { reason },
  });
}

export async function notifyAgentUnblocked(
  userId: string
) {
  return notify({
    tenantId: resolveTenantId(),
    event: 'agent_unblocked',
    recipients: [Number(userId)],
    title: 'Account Unblocked',
    message: 'Your account has been unblocked. You can now receive new deliveries.',
  });
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
  await notify({
    tenantId: resolveTenantId(),
    event: 'no_assignee_available',
    recipients: 'owner',
    title: `No ${noun} is available`,
    message: `New orders are waiting: every ${noun} is unavailable or away. Set someone to available so orders can be assigned.`,
    data: { scope, role },
  });
}

export { checkQueueWaitAlerts, notifyQueueWaitAlert } from './queueAlertService';
