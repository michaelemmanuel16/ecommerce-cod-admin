import prisma from '../utils/prisma';
import { getSocketInstance } from '../utils/socketInstance';
import { emitNotification } from '../sockets';
import { getTenantId, resolveTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';


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
    where: { role: { in: ['admin', 'super_admin'] }, isActive: true },
    select: { id: true }
  });

  const agentSummary = agents
    .map(a => `${a.agentName}: GHS ${Money.toApi(a.totalBalance)} (${a.criticalAmount.gt(0) ? '8+ days' : '4-7 days'})`)
    .join(', ');

  const totalOverdue = Money.sum(agents.map(a => a.totalBalance));

  for (const admin of admins) {
    await createNotification(
      admin.id.toString(),
      'overdue_collections',
      'Overdue Agent Collections',
      `${agents.length} agent(s) have overdue collections totaling GHS ${Money.toApi(totalOverdue)}: ${agentSummary}`,
      {
        agents: agents.map(a => ({
          ...a,
          totalBalance: Money.toApi(a.totalBalance),
          warningAmount: Money.toApi(a.warningAmount),
          criticalAmount: Money.toApi(a.criticalAmount)
        })),
        totalOverdue: Money.toApi(totalOverdue)
      }
    );
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
