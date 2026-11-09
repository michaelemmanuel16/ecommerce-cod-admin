import prisma from '../utils/prisma';
import { getStoreTimeZone } from './kpi/dates';
import { readOperatingHours, workingMinutesBetween } from './kpi/workingTime';
import { createNotification } from './notificationService';
import { HUMAN_USERS_WHERE } from './systemUserService';

export const findQueueAlertRecipients = (tenantId: string) => prisma.user.findMany({
  where: { tenantId, role: { in: ['super_admin', 'admin', 'manager'] }, isActive: true, ...HUMAN_USERS_WHERE },
  select: { id: true },
});

export interface QueueWaitAlertInput {
  id: number;
  orderNumber?: string;
  tenantId: string;
  waitMinutes: number;
  alertMinutes: number;
}

export async function notifyQueueWaitAlert(order: QueueWaitAlertInput): Promise<boolean> {
  const existing = await prisma.notification.findFirst({
    where: {
      tenantId: order.tenantId,
      type: 'queue_wait_alert',
      data: { path: ['orderId'], equals: order.id },
    },
    select: { id: true },
  });
  if (existing) return false;

  const recipients = await findQueueAlertRecipients(order.tenantId);
  const rounded = Math.round(order.waitMinutes);
  const orderRef = order.orderNumber ? `#${order.orderNumber}` : `#${order.id}`;
  const title = 'Queue wait alert';
  const message = `Order ${orderRef} has been waiting ${rounded} min in the call queue (limit: ${order.alertMinutes} min)`;
  const data = {
    orderId: order.id,
    orderNumber: order.orderNumber ?? String(order.id),
    waitMinutes: rounded,
    alertMinutes: order.alertMinutes,
  };

  for (const recipient of recipients) {
    await createNotification(recipient.id.toString(), 'queue_wait_alert', title, message, data);
  }
  return true;
}

export async function checkQueueWaitAlerts(tenantId: string, now: Date = new Date()): Promise<number[]> {
  const config = await prisma.systemConfig.findUnique({
    where: { tenantId },
    select: { operatingHours: true, timeZone: true },
  });
  const hours = readOperatingHours(config?.operatingHours);
  const alertMinutes = (config?.operatingHours as any)?.queueWaitAlertMinutes ?? 30;
  const zone = config?.timeZone || getStoreTimeZone(tenantId);

  const waitingOrders = await prisma.order.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: 'pending_confirmation',
      firstContactAt: null,
      customerResponse: null,
    },
    select: {
      id: true,
      createdAt: true,
      tenantId: true,
    },
  });

  const alertedOrderIds: number[] = [];
  for (const order of waitingOrders) {
    const minutes = workingMinutesBetween(order.createdAt, now, hours, zone);
    if (minutes >= alertMinutes) {
      const notified = await notifyQueueWaitAlert({
        id: order.id,
        tenantId: order.tenantId ?? tenantId,
        waitMinutes: minutes,
        alertMinutes,
      });
      if (notified) {
        alertedOrderIds.push(order.id);
      }
    }
  }
  return alertedOrderIds;
}
