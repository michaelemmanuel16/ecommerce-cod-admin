import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { MessageChannel, MessageDirection, MessageStatus } from '@prisma/client';

// WhatsApp Business Cloud API configuration
const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0';

interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  webhookVerifyToken: string;
  businessAccountId?: string;
}

function getConfig(): WhatsAppConfig {
  return {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  };
}

function isConfigured(): boolean {
  const config = getConfig();
  return !!(config.accessToken && config.phoneNumberId);
}

// Order status → WhatsApp template mapping.
// Only the statuses customers care about are auto-messaged here.
// Other statuses (preparing, ready_for_pickup, cancelled) can be triggered via Workflows.
export const ORDER_STATUS_TEMPLATES: Record<string, {
  templateName: string;
  bodyParams: (order: OrderContext) => string[];
}> = {
  order_created: {
    templateName: 'order_created',
    bodyParams: (o) => [o.customerName, String(o.orderId), `GHS ${o.totalAmount.toFixed(2)}`],
  },
  confirmed: {
    templateName: 'order_confirmed',
    bodyParams: (o) => [o.customerName, String(o.orderId), `GHS ${o.totalAmount.toFixed(2)}`],
  },
  out_for_delivery: {
    templateName: 'order_out_for_delivery',
    bodyParams: (o) => [o.customerName, String(o.orderId), o.deliveryAgentName || 'your delivery agent'],
  },
  delivered: {
    templateName: 'order_delivered',
    bodyParams: (o) => [o.customerName, String(o.orderId), `GHS ${o.totalAmount.toFixed(2)}`],
  },
  failed_delivery: {
    templateName: 'order_delivery_failed',
    bodyParams: (o) => [o.customerName, String(o.orderId)],
  },
};

export interface OrderContext {
  orderId: number;
  customerId: number;
  customerName: string;
  customerPhone: string;
  totalAmount: number;
  deliveryAgentName?: string;
  status: string;
}

interface SendTemplateOptions {
  to: string;
  templateName: string;
  languageCode?: string;
  bodyParams?: string[];
  orderId?: number;
  customerId?: number;
}

interface SendTextOptions {
  to: string;
  body: string;
  orderId?: number;
  customerId?: number;
}

interface WhatsAppApiResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

/**
 * Format phone number for WhatsApp API.
 * WhatsApp expects international format without + prefix (e.g. "233241234567").
 *
 * Handles:
 * - Already international with + prefix: "+233241234567" → "233241234567"
 * - Already international without +: "233241234567" → "233241234567"
 * - Ghana local: "0241234567" (10 digits, starts with 0) → "233241234567"
 * - Unknown formats: passed through as-is after cleaning
 */
export function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/[\s\-()]/g, '');

  // Remove leading +
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }

  // Already in international format (starts with country code, typically 10+ digits)
  if (cleaned.length >= 11 && !cleaned.startsWith('0')) {
    return cleaned;
  }

  // Ghana local number: 10 digits starting with 0 → prefix with 233
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return '233' + cleaned.substring(1);
  }

  // Pass through — may already be correct or in an unknown format
  return cleaned;
}

/**
 * Build a human-readable message body from a template for logging purposes.
 */
function buildMessageBody(templateName: string, bodyParams: string[]): string {
  const templates: Record<string, string> = {
    order_created: `Hi {1}, we've received your order #{2}! Total: {3}. We'll confirm it shortly and keep you updated.`,
    order_confirmed: `Hi {1}, your order #{2} has been confirmed! Total: {3}. We'll update you as it progresses.`,
    order_out_for_delivery: `Hi {1}, your order #{2} is out for delivery! {3} is on the way.`,
    order_delivered: `Hi {1}, your order #{2} has been delivered! Amount collected: {3}. Thank you for your purchase!`,
    order_delivery_failed: `Hi {1}, we were unable to deliver your order #{2}. We'll contact you to reschedule.`,
  };

  let body = templates[templateName] || `Template: ${templateName}`;
  bodyParams.forEach((param, i) => {
    body = body.replace(`{${i + 1}}`, param);
  });
  return body;
}

class WhatsAppService {
  /**
   * Send a template message via WhatsApp Business Cloud API.
   */
  async sendTemplate(options: SendTemplateOptions): Promise<{ messageLogId: number; providerMessageId?: string }> {
    const { to, templateName, languageCode = 'en', bodyParams = [], orderId, customerId } = options;
    const formattedPhone = formatPhoneNumber(to);
    const messageBody = buildMessageBody(templateName, bodyParams);

    // Create message log entry
    const messageLog = await prisma.messageLog.create({
      data: {
        orderId,
        customerId,
        channel: MessageChannel.whatsapp,
        direction: MessageDirection.outbound,
        templateName,
        messageBody,
        status: MessageStatus.pending,
        metadata: { bodyParams, languageCode, to: formattedPhone },
      },
    });

    if (!isConfigured()) {
      logger.warn('WhatsApp not configured — message logged but not sent', {
        messageLogId: messageLog.id,
        templateName,
      });
      return { messageLogId: messageLog.id };
    }

    try {
      const config = getConfig();
      const payload = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: bodyParams.length > 0
            ? [{
                type: 'body',
                parameters: bodyParams.map(text => ({ type: 'text', text })),
              }]
            : undefined,
        },
      };

      const response = await fetch(`${WHATSAPP_API_URL}/${config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`WhatsApp API error ${response.status}: ${errorBody}`);
      }

      const data = await response.json() as WhatsAppApiResponse;
      const providerMessageId = data.messages?.[0]?.id;

      await prisma.messageLog.update({
        where: { id: messageLog.id },
        data: {
          status: MessageStatus.sent,
          providerMessageId,
          sentAt: new Date(),
        },
      });

      logger.info('WhatsApp template message sent', {
        messageLogId: messageLog.id,
        templateName,
        to: formattedPhone,
        providerMessageId,
      });

      return { messageLogId: messageLog.id, providerMessageId };
    } catch (error: any) {
      await prisma.messageLog.update({
        where: { id: messageLog.id },
        data: {
          status: MessageStatus.failed,
          errorMessage: error.message?.substring(0, 500),
        },
      });

      logger.error('Failed to send WhatsApp template message', {
        messageLogId: messageLog.id,
        templateName,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Send a free-form text message via WhatsApp.
   */
  async sendText(options: SendTextOptions): Promise<{ messageLogId: number; providerMessageId?: string }> {
    const { to, body, orderId, customerId } = options;
    const formattedPhone = formatPhoneNumber(to);

    const messageLog = await prisma.messageLog.create({
      data: {
        orderId,
        customerId,
        channel: MessageChannel.whatsapp,
        direction: MessageDirection.outbound,
        messageBody: body,
        status: MessageStatus.pending,
        metadata: { to: formattedPhone },
      },
    });

    if (!isConfigured()) {
      logger.warn('WhatsApp not configured — text message logged but not sent', {
        messageLogId: messageLog.id,
      });
      return { messageLogId: messageLog.id };
    }

    try {
      const config = getConfig();
      const payload = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'text',
        text: { body },
      };

      const response = await fetch(`${WHATSAPP_API_URL}/${config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`WhatsApp API error ${response.status}: ${errorBody}`);
      }

      const data = await response.json() as WhatsAppApiResponse;
      const providerMessageId = data.messages?.[0]?.id;

      await prisma.messageLog.update({
        where: { id: messageLog.id },
        data: {
          status: MessageStatus.sent,
          providerMessageId,
          sentAt: new Date(),
        },
      });

      logger.info('WhatsApp text message sent', {
        messageLogId: messageLog.id,
        to: formattedPhone,
        providerMessageId,
      });

      return { messageLogId: messageLog.id, providerMessageId };
    } catch (error: any) {
      await prisma.messageLog.update({
        where: { id: messageLog.id },
        data: {
          status: MessageStatus.failed,
          errorMessage: error.message?.substring(0, 500),
        },
      });

      logger.error('Failed to send WhatsApp text message', {
        messageLogId: messageLog.id,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Process inbound webhook status update from WhatsApp.
   * Updates MessageLog with delivery/read receipts.
   */
  async processStatusUpdate(providerMessageId: string, status: string, timestamp?: number): Promise<void> {
    const statusMap: Record<string, MessageStatus> = {
      sent: MessageStatus.sent,
      delivered: MessageStatus.delivered,
      read: MessageStatus.read,
      failed: MessageStatus.failed,
    };

    const mappedStatus = statusMap[status];
    if (!mappedStatus) {
      logger.warn('Unknown WhatsApp status update', { providerMessageId, status });
      return;
    }

    const messageLog = await prisma.messageLog.findUnique({
      where: { providerMessageId },
    });

    if (!messageLog) {
      logger.warn('MessageLog not found for status update', { providerMessageId });
      return;
    }

    const updateData: any = { status: mappedStatus };
    const eventTime = timestamp ? new Date(timestamp * 1000) : new Date();

    if (mappedStatus === MessageStatus.delivered) {
      updateData.deliveredAt = eventTime;
    } else if (mappedStatus === MessageStatus.read) {
      updateData.readAt = eventTime;
    }

    await prisma.messageLog.update({
      where: { id: messageLog.id },
      data: updateData,
    });

    logger.info('WhatsApp message status updated', {
      messageLogId: messageLog.id,
      providerMessageId,
      newStatus: mappedStatus,
    });
  }

  /**
   * Get message logs with pagination and filters.
   */
  async getMessages(params: {
    page?: number;
    limit?: number;
    channel?: MessageChannel;
    status?: MessageStatus;
    orderId?: number;
    customerId?: number;
    startDate?: string;
    endDate?: string;
  }) {
    const { page = 1, limit = 20, channel, status, orderId, customerId, startDate, endDate } = params;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (channel) where.channel = channel;
    if (status) where.status = status;
    if (orderId) where.orderId = orderId;
    if (customerId) where.customerId = customerId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [messages, total] = await Promise.all([
      prisma.messageLog.findMany({
        where,
        include: {
          order: { select: { id: true, status: true, totalAmount: true } },
          customer: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.messageLog.count({ where }),
    ]);

    return {
      data: messages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a single message log by ID.
   */
  async getMessageById(id: number) {
    return prisma.messageLog.findUnique({
      where: { id },
      include: {
        order: { select: { id: true, status: true, totalAmount: true, deliveryAddress: true } },
        customer: { select: { id: true, firstName: true, lastName: true, phoneNumber: true } },
      },
    });
  }

  /**
   * Get message statistics for dashboard.
   */
  async getStats(startDate?: string, endDate?: string) {
    const where: any = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [total, byStatus, byChannel] = await Promise.all([
      prisma.messageLog.count({ where }),
      prisma.messageLog.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),
      prisma.messageLog.groupBy({
        by: ['channel'],
        where,
        _count: true,
      }),
    ]);

    return {
      total,
      byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count])),
      byChannel: Object.fromEntries(byChannel.map(c => [c.channel, c._count])),
    };
  }
}

export const whatsappService = new WhatsAppService();
export default whatsappService;
