import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { MessageChannel } from '@prisma/client';
import { formatPhoneNumber, OrderContext } from './whatsappService';
import { getTenantId } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { messageSender, throwIfFailed } from './messaging/messageSender';

// The Arkesel adapter owns the provider call and its config
export { getDbSmsConfig, clearSmsConfigCache } from './messaging/providers/arkeselSmsProvider';

// Plain-text SMS templates matching WhatsApp templates
export const SMS_TEMPLATES: Record<string, {
  body: (ctx: OrderContext) => string;
}> = {
  order_created: {
    body: (o) => `Hi ${o.customerName}, we've received your order #${o.orderId}! We'll confirm it shortly.`,
  },
  confirmed: {
    body: (o) => `Hi ${o.customerName}, your order #${o.orderId} has been confirmed!`,
  },
  out_for_delivery: {
    body: (o) => `Hi ${o.customerName}, your order #${o.orderId} is out for delivery!${o.deliveryAgentName ? ` ${o.deliveryAgentName} is on the way.` : ''}`,
  },
  delivered: {
    body: (o) => `Hi ${o.customerName}, Your order #${o.orderId}, ${o.productName || 'your items'} ${o.productName?.includes(',') ? 'have' : 'has'} been delivered. Thank you for shopping with us!`,
  },
  failed_delivery: {
    body: (o) => `Hi ${o.customerName}, we couldn't deliver order #${o.orderId}. We'll contact you to reschedule.`,
  },
};

interface SendSmsOptions {
  to: string;
  body: string;
  /** What the message log keeps instead of `body` (a text with a secret link). The provider still gets `body`. */
  logBody?: string;
  orderId?: number;
  customerId?: number;
  conversationId?: number;
  inReplyToId?: number;
  /** The WhatsApp message this SMS replaces */
  fallbackOfId?: number;
  retryOfId?: number;
}

class SmsService {
  async sendSms(options: SendSmsOptions): Promise<{ messageLogId: number; providerMessageId?: string; sent: boolean; skipped?: boolean }> {
    const { to, body, logBody, orderId, customerId, conversationId, inReplyToId, fallbackOfId, retryOfId } = options;
    const result = await messageSender.send({
      tenantId: getTenantId(),
      channel: MessageChannel.sms,
      to: formatPhoneNumber(to),
      body,
      logBody,
      orderId,
      customerId,
      conversationId,
      inReplyToId,
      fallbackOfId,
      retryOfId,
    });
    throwIfFailed(result);
    return { messageLogId: result.messageLogId, providerMessageId: result.providerMessageId, sent: result.sent, ...(result.skipped ? { skipped: true } : {}) };
  }
}

export const smsService = new SmsService();

/**
 * Look up the order, build context, and send an SMS.
 * Shared helper mirroring sendWhatsAppForOrder().
 */
export async function sendSmsForOrder(
  templateKey: string,
  orderId: number,
  fallbackOfId?: number,
): Promise<{ messageLogId: number; providerMessageId?: string; sent?: boolean }> {
  const templateConfig = SMS_TEMPLATES[templateKey];
  if (!templateConfig) {
    throw new Error(`Unknown SMS template: ${templateKey}`);
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      customer: true,
      deliveryAgent: true,
      orderItems: { include: { product: true } },
    },
  });

  if (!order || !order.customer) {
    throw new Error(`Order ${orderId} not found or has no customer`);
  }

  if (order.customer.smsOptOut) {
    logger.info('Skipping SMS send — customer opted out', { orderId, customerId: order.customer.id });
    return { messageLogId: 0 };
  }

  const orderContext: OrderContext = {
    orderId: order.id,
    customerId: order.customer.id,
    customerName: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
    customerPhone: order.customer.phoneNumber,
    totalAmount: Money.parse(order.totalAmount),
    deliveryAgentName: order.deliveryAgent
      ? `${order.deliveryAgent.firstName} ${order.deliveryAgent.lastName}`.trim()
      : undefined,
    productName: order.orderItems
      ?.map((item: any) => item.product?.name)
      .filter(Boolean)
      .join(', ') || undefined,
    status: order.status,
  };

  const body = templateConfig.body(orderContext);
  return smsService.sendSms({
    to: orderContext.customerPhone,
    body,
    orderId: order.id,
    customerId: orderContext.customerId,
    fallbackOfId,
  });
}

export default smsService;
