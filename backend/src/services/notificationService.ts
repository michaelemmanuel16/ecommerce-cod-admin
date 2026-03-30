import prisma from '../utils/prisma';
import { getSocketInstance } from '../utils/socketInstance';
import { emitNotification } from '../sockets';
import { getTenantId } from '../utils/tenantContext';

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  data?: any
) {
  const tenantId = getTenantId();
  const notification = await prisma.notification.create({
    data: {
      userId: parseInt(userId, 10),
      type,
      title,
      message,
      data: data || {},
      ...(tenantId ? { tenantId } : {})
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

export async function notifyOrderStatusChanged(
  userId: string,
  orderId: string,
  orderNumber: string,
  newStatus: string
) {
  return createNotification(
    userId,
    'order',
    'Order Status Updated',
    `Order ${orderNumber} status changed to ${newStatus}`,
    { orderId, orderNumber, status: newStatus }
  );
}

export async function notifyDeliveryScheduled(
  userId: string,
  orderId: string,
  orderNumber: string,
  scheduledTime: Date
) {
  return createNotification(
    userId,
    'delivery',
    'Delivery Scheduled',
    `Delivery for order ${orderNumber} scheduled for ${scheduledTime.toLocaleString()}`,
    { orderId, orderNumber, scheduledTime }
  );
}

export async function notifyAdminsOverdueCollections(
  agents: { agentId: number; agentName: string; totalBalance: number; warningAmount: number; criticalAmount: number }[]
) {
  if (agents.length === 0) return;

  // Find all admin and super_admin users
  const admins = await prisma.user.findMany({
    where: { role: { in: ['admin', 'super_admin'] }, isActive: true },
    select: { id: true }
  });

  const agentSummary = agents
    .map(a => `${a.agentName}: GHS ${a.totalBalance.toFixed(2)} (${a.criticalAmount > 0 ? '8+ days' : '4-7 days'})`)
    .join(', ');

  const totalOverdue = agents.reduce((sum, a) => sum + a.totalBalance, 0);

  for (const admin of admins) {
    await createNotification(
      admin.id.toString(),
      'overdue_collections',
      'Overdue Agent Collections',
      `${agents.length} agent(s) have overdue collections totaling GHS ${totalOverdue.toFixed(2)}: ${agentSummary}`,
      { agents, totalOverdue }
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
