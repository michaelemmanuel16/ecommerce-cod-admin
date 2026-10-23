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

export async function notifyAdminsOverdueCollections(
  agents: { agentId: number; agentName: string; totalBalance: Money.Money; warningAmount: Money.Money; criticalAmount: Money.Money }[]
) {
  if (agents.length === 0) return;

  // Admins of the current tenant only (the scoped query adds tenantId).
  // Callers run this once per tenant.
  const admins = await prisma.user.findMany({
    where: { role: { in: ['admin', 'super_admin'] }, isActive: true, ...HUMAN_USERS_WHERE }, // not the system user
    select: { id: true }
  });

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
