import prisma, { prismaBase } from '../utils/prisma';
import { getSocketInstance } from '../utils/socketInstance';
import { emitNotification } from '../sockets';


export async function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  data?: any
) {
  const notification = await prisma.notification.create({
    data: {
      userId: parseInt(userId, 10),
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
  agents: { agentId: number; tenantId: string | null; agentName: string; totalBalance: number; warningAmount: number; criticalAmount: number }[]
) {
  if (agents.length === 0) return;

  // MAN-95: this cron runs cross-tenant, so notifying every admin leaked each
  // store's collections to every other store's admins. Group the overdue agents
  // by their store, then page THAT store's owner resolved by direct FK
  // (Tenant.ownerUserId) — not by a (tenantId, role) scan. prismaBase because a
  // system cron has no tenant context and we resolve each owner explicitly.
  const byTenant = new Map<string, typeof agents>();
  for (const a of agents) {
    if (!a.tenantId) continue; // orphan agent with no store — nobody to notify
    const list = byTenant.get(a.tenantId) ?? [];
    list.push(a);
    byTenant.set(a.tenantId, list);
  }

  for (const [tenantId, tenantAgents] of byTenant) {
    const tenant = await prismaBase.tenant.findUnique({
      where: { id: tenantId },
      select: { ownerUserId: true },
    });
    if (!tenant?.ownerUserId) continue; // store has no owner yet — skip

    const agentSummary = tenantAgents
      .map(a => `${a.agentName}: GHS ${a.totalBalance.toFixed(2)} (${a.criticalAmount > 0 ? '8+ days' : '4-7 days'})`)
      .join(', ');
    const totalOverdue = tenantAgents.reduce((sum, a) => sum + a.totalBalance, 0);

    await createNotification(
      tenant.ownerUserId.toString(),
      'overdue_collections',
      'Overdue Agent Collections',
      `${tenantAgents.length} agent(s) have overdue collections totaling GHS ${totalOverdue.toFixed(2)}: ${agentSummary}`,
      { agents: tenantAgents, totalOverdue }
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
