import prisma from '../utils/prisma';
import { getStoreTimeZone } from './kpi/dates';
import {
  readOperatingHours,
  workingMinutesBetween,
  DEFAULT_QUEUE_WAIT_ALERT_MINUTES,
} from './kpi/workingTime';
import { createNotification } from './notificationService';
import { HUMAN_USERS_WHERE } from './systemUserService';
import { formatOrderNumber } from '../utils/orderNumber';

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
  const orderRef = formatOrderNumber(order.id);
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
  const alertMinutes = hours?.queueWaitAlertMinutes ?? DEFAULT_QUEUE_WAIT_ALERT_MINUTES;
  const zone = config?.timeZone || getStoreTimeZone(tenantId);

  const cutoff = new Date(now.getTime() - alertMinutes * 60 * 1000);
  const waitingOrders = await prisma.order.findMany({
    where: {
      tenantId,
      deletedAt: null,
      status: 'pending_confirmation',
      firstContactAt: null,
      createdAt: { lte: cutoff },
    },
    select: {
      id: true,
      createdAt: true,
      tenantId: true,
    },
  });

  const candidates: Array<{ id: number; waitMinutes: number }> = [];
  for (const order of waitingOrders) {
    const minutes = workingMinutesBetween(order.createdAt, now, hours, zone);
    if (minutes >= alertMinutes) {
      candidates.push({ id: order.id, waitMinutes: minutes });
    }
  }

  if (candidates.length === 0) return [];

  const recipients = await findQueueAlertRecipients(tenantId);

  const notifiedOrderIds = new Set<number>();
  if (typeof prisma.notification.findMany === 'function') {
    const existingNotifications = await prisma.notification.findMany({
      where: {
        tenantId,
        type: 'queue_wait_alert',
      },
      select: { data: true },
    });
    for (const n of existingNotifications) {
      const orderId = Number((n.data as any)?.orderId);
      if (!Number.isNaN(orderId)) {
        notifiedOrderIds.add(orderId);
      }
    }
  } else if (typeof prisma.notification.findFirst === 'function') {
    for (const c of candidates) {
      const existing = await prisma.notification.findFirst({
        where: {
          tenantId,
          type: 'queue_wait_alert',
          data: { path: ['orderId'], equals: c.id },
        },
        select: { id: true },
      });
      if (existing) {
        notifiedOrderIds.add(c.id);
      }
    }
  }

  const alertedOrderIds: number[] = [];
  for (const c of candidates) {
    if (notifiedOrderIds.has(c.id)) continue;

    const rounded = Math.round(c.waitMinutes);
    const orderRef = formatOrderNumber(c.id);
    const title = 'Queue wait alert';
    const message = `Order ${orderRef} has been waiting ${rounded} min in the call queue (limit: ${alertMinutes} min)`;
    const data = {
      orderId: c.id,
      orderNumber: String(c.id),
      waitMinutes: rounded,
      alertMinutes,
    };

    for (const recipient of recipients) {
      await createNotification(recipient.id.toString(), 'queue_wait_alert', title, message, data);
    }
    notifiedOrderIds.add(c.id);
    alertedOrderIds.push(c.id);
  }
  return alertedOrderIds;
}
