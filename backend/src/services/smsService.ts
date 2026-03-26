import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { MessageChannel, MessageDirection, MessageStatus } from '@prisma/client';
import { decryptProviderSecrets } from '../utils/providerCrypto';
import { formatPhoneNumber, OrderContext } from './whatsappService';

// Arkesel SMS API
const ARKESEL_API_URL = 'https://sms.arkesel.com/api/v2/sms/send';

interface SmsConfig {
  apiKey: string;
  senderId: string;
  isEnabled: boolean;
}

// Cached DB config with 60s TTL (mirrors WhatsApp pattern)
let cachedDbConfig: { data: any; fetchedAt: number } | null = null;
const CONFIG_CACHE_TTL = 60_000;

export async function getDbSmsConfig(): Promise<SmsConfig | null> {
  const now = Date.now();
  if (cachedDbConfig && now - cachedDbConfig.fetchedAt < CONFIG_CACHE_TTL) {
    return cachedDbConfig.data;
  }

  try {
    const config = await prisma.systemConfig.findFirst({ select: { smsProvider: true } });
    const provider = config?.smsProvider as any;
    const decrypted = provider ? decryptProviderSecrets('smsProvider', provider) : null;

    if (!decrypted || !decrypted.authToken) {
      cachedDbConfig = { data: null, fetchedAt: now };
      return null;
    }

    const smsConfig: SmsConfig = {
      apiKey: decrypted.authToken,
      senderId: decrypted.senderId || 'CODAdmin',
      isEnabled: decrypted.isEnabled !== false,
    };

    cachedDbConfig = { data: smsConfig, fetchedAt: now };
    return smsConfig;
  } catch (error: any) {
    logger.warn('Failed to read SMS config from DB', { error: error.message });
    return null;
  }
}

export function clearSmsConfigCache(): void {
  cachedDbConfig = null;
}

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
  orderId?: number;
  customerId?: number;
}

class SmsService {
  async sendSms(options: SendSmsOptions): Promise<{ messageLogId: number; providerMessageId?: string }> {
    const { to, body, orderId, customerId } = options;
    const formattedPhone = formatPhoneNumber(to);

    const messageLog = await prisma.messageLog.create({
      data: {
        orderId,
        customerId,
        channel: MessageChannel.sms,
        direction: MessageDirection.outbound,
        messageBody: body,
        status: MessageStatus.pending,
        metadata: { to: formattedPhone },
      },
    });

    const providerMessageId = await this.dispatch(messageLog.id, formattedPhone, body);
    return { messageLogId: messageLog.id, providerMessageId };
  }

  private async dispatch(messageLogId: number, phone: string, message: string): Promise<string | undefined> {
    const config = await getDbSmsConfig();

    if (!config) {
      logger.warn('SMS not configured, skipping send', { messageLogId });
      return undefined;
    }

    if (!config.isEnabled) {
      logger.info('SMS disabled, skipping send', { messageLogId });
      return undefined;
    }

    try {
      const response = await fetch(ARKESEL_API_URL, {
        method: 'POST',
        headers: {
          'api-key': config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: config.senderId,
          message,
          recipients: [phone],
        }),
      });

      const data: any = await response.json();

      if (!response.ok) {
        const errorMsg = data?.message || JSON.stringify(data);
        await prisma.messageLog.update({
          where: { id: messageLogId },
          data: { status: MessageStatus.failed, errorMessage: errorMsg.substring(0, 500) },
        });
        throw new Error(`Arkesel API error ${response.status}: ${errorMsg}`);
      }

      const providerMessageId = data?.data?.[0]?.id || undefined;

      await prisma.messageLog.update({
        where: { id: messageLogId },
        data: {
          status: MessageStatus.sent,
          sentAt: new Date(),
          providerMessageId,
        },
      });

      logger.info('SMS sent successfully', { messageLogId, providerMessageId, phone });
      return providerMessageId;
    } catch (error: any) {
      if (!error.message?.startsWith('Arkesel API error')) {
        await prisma.messageLog.update({
          where: { id: messageLogId },
          data: { status: MessageStatus.failed, errorMessage: error.message?.substring(0, 500) },
        });
      }
      throw error;
    }
  }

  async processStatusUpdate(providerMessageId: string, status: string): Promise<void> {
    const messageLog = await prisma.messageLog.findFirst({
      where: { providerMessageId, channel: MessageChannel.sms },
    });

    if (!messageLog) {
      logger.warn('SMS status update for unknown message', { providerMessageId, status });
      return;
    }

    const statusMap: Record<string, MessageStatus> = {
      delivered: MessageStatus.delivered,
      failed: MessageStatus.failed,
      rejected: MessageStatus.failed,
    };

    const mappedStatus = statusMap[status.toLowerCase()];
    if (!mappedStatus) {
      logger.debug('Unknown SMS delivery status', { providerMessageId, status });
      return;
    }

    const updateData: any = { status: mappedStatus };
    if (mappedStatus === MessageStatus.delivered) {
      updateData.deliveredAt = new Date();
    }

    await prisma.messageLog.update({
      where: { id: messageLog.id },
      data: updateData,
    });

    logger.info('SMS delivery status updated', { messageLogId: messageLog.id, status: mappedStatus });
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
): Promise<{ messageLogId: number; providerMessageId?: string }> {
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

  const orderContext: OrderContext = {
    orderId: order.id,
    customerId: order.customer.id,
    customerName: `${order.customer.firstName} ${order.customer.lastName}`.trim(),
    customerPhone: order.customer.phoneNumber,
    totalAmount: Number(order.totalAmount),
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
  });
}

export default smsService;
