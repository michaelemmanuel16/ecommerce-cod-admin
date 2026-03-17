import Bull from 'bull';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import whatsappService, { ORDER_STATUS_TEMPLATES, OrderContext } from '../services/whatsappService';

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
};

// Use dummy queue for tests to avoid Redis connection errors
export const messagingQueue = process.env.NODE_ENV === 'test'
  ? ({
    process: () => {},
    on: () => {},
    add: () => {},
    close: () => Promise.resolve(),
  } as any)
  : new Bull('order-status-messaging', {
    redis: redisConfig,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000, // 5s, 10s, 20s
      },
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 200,     // Keep last 200 failed jobs
    },
  });

interface OrderStatusMessageJob {
  orderId: number;
  oldStatus: string;
  newStatus: string;
}

// Process order status messaging jobs
messagingQueue.process('send-status-message', async (job: Bull.Job<OrderStatusMessageJob>) => {
  const { orderId, newStatus } = job.data;

  const template = ORDER_STATUS_TEMPLATES[newStatus];
  if (!template) {
    logger.info('No WhatsApp template for status, skipping', { orderId, newStatus });
    return { skipped: true, reason: 'no_template' };
  }

  // Fetch order with customer and delivery agent
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: {
        select: { id: true, firstName: true, lastName: true, phoneNumber: true },
      },
      deliveryAgent: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  });

  if (!order || !order.customer) {
    logger.warn('Order or customer not found for status message', { orderId });
    return { skipped: true, reason: 'order_not_found' };
  }

  const context: OrderContext = {
    orderId: order.id,
    customerId: order.customer.id,
    customerName: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
    customerPhone: order.customer.phoneNumber,
    totalAmount: order.totalAmount,
    deliveryAgentName: order.deliveryAgent
      ? `${order.deliveryAgent.firstName} ${order.deliveryAgent.lastName}`.trim()
      : undefined,
    status: newStatus,
  };

  const result = await whatsappService.sendTemplate({
    to: context.customerPhone,
    templateName: template.templateName,
    bodyParams: template.bodyParams(context),
    orderId: order.id,
    customerId: order.customer.id,
  });

  logger.info('Order status WhatsApp message queued', {
    orderId,
    newStatus,
    messageLogId: result.messageLogId,
  });

  return { messageLogId: result.messageLogId };
});

// Log queue events
if (process.env.NODE_ENV !== 'test') {
  messagingQueue.on('failed', (job: Bull.Job, err: Error) => {
    logger.error('Messaging queue job failed', {
      jobId: job.id,
      orderId: job.data.orderId,
      newStatus: job.data.newStatus,
      attempt: job.attemptsMade,
      error: err.message,
    });
  });

  messagingQueue.on('completed', (job: Bull.Job, result: any) => {
    if (!result?.skipped) {
      logger.info('Messaging queue job completed', {
        jobId: job.id,
        orderId: job.data.orderId,
        messageLogId: result?.messageLogId,
      });
    }
  });
}

/**
 * Enqueue a WhatsApp status notification for an order.
 * Called from orderService.updateOrderStatus().
 */
export function enqueueOrderStatusMessage(orderId: number, oldStatus: string, newStatus: string): void {
  messagingQueue.add('send-status-message', {
    orderId,
    oldStatus,
    newStatus,
  }).catch((err: Error) => {
    logger.error('Failed to enqueue order status message', {
      orderId,
      newStatus,
      error: err.message,
    });
  });
}
