import prisma from '../utils/prisma';
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
      data: data || {}
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
