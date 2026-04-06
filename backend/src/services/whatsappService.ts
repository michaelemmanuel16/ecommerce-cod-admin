import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { MessageChannel, MessageDirection, MessageStatus, Prisma } from '@prisma/client';
import { decryptProviderSecrets } from '../utils/providerCrypto';
import { refreshTokenIfNeeded } from './whatsappTokenRefreshService';
import { getTenantId } from '../utils/tenantContext';

// WhatsApp Business Cloud API configuration
const WHATSAPP_API_URL = 'https://graph.facebook.com/v21.0';

interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  webhookVerifyToken: string;
  businessAccountId?: string;
  isEnabled: boolean;
  authMode?: 'manual' | 'oauth';
  oauthTokenExpiry?: string;
}

// Tenant-aware cached DB config to avoid per-message DB queries
const configCache = new Map<string, { data: any; fetchedAt: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

export async function getDbWhatsappConfig(): Promise<any | null> {
  const tenantId = getTenantId() || '__default__';
  const now = Date.now();
  const cached = configCache.get(tenantId);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const config = await prisma.systemConfig.findFirst({
      select: { whatsappProvider: true },
    });
    const provider = config?.whatsappProvider as any;
    const decrypted = provider ? decryptProviderSecrets('whatsappProvider', provider) : null;
    configCache.set(tenantId, { data: decrypted, fetchedAt: now });
    return decrypted;
  } catch (error: any) {
    logger.warn('Failed to read WhatsApp config from DB, falling back to env vars', { error: error.message });
    return null;
  }
}

/** Clear cached DB config (call after admin saves new settings). */
export function clearWhatsAppConfigCache(): void {
  configCache.clear();
}

async function getConfig(): Promise<WhatsAppConfig> {
  const dbConfig = await getDbWhatsappConfig();

  // DB config takes precedence when present and enabled
  if (dbConfig && dbConfig.accessToken && dbConfig.phoneNumberId) {
    return {
      accessToken: dbConfig.accessToken,
      phoneNumberId: dbConfig.phoneNumberId,
      appSecret: dbConfig.appSecret || process.env.WHATSAPP_APP_SECRET || '',
      webhookVerifyToken: dbConfig.webhookVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
      businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      isEnabled: dbConfig.isEnabled !== false,
      authMode: dbConfig.authMode,
      oauthTokenExpiry: dbConfig.oauthTokenExpiry,
    };
  }

  // Fall back to env vars
  return {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    isEnabled: true,
  };
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
    bodyParams: (o) => [o.customerName, `#${o.orderId}`],
  },
  confirmed: {
    templateName: 'order_confirmed',
    bodyParams: (o) => [o.customerName, `#${o.orderId}`],
  },
  out_for_delivery: {
    templateName: 'order_out_for_delivery',
    bodyParams: (o) => [o.customerName, `#${o.orderId}, ${o.productName || 'your items'}`],
  },
  delivered: {
    templateName: 'order_delivered',
    bodyParams: (o) => [o.customerName, `#${o.orderId}, ${o.productName || 'your items'}`],
  },
  failed_delivery: {
    templateName: 'order_delivery_failed',
    bodyParams: (o) => [o.customerName, `#${o.orderId}`],
  },
};

// Reverse lookup: templateName → config (for test endpoint)
export const TEMPLATE_BY_NAME = Object.fromEntries(
  Object.values(ORDER_STATUS_TEMPLATES).map(t => [t.templateName, t])
);

export interface OrderContext {
  orderId: number;
  customerId: number;
  customerName: string;
  customerPhone: string;
  totalAmount: number;
  deliveryAgentName?: string;
  productName?: string;
  status: string;
}

/**
 * Look up the order, build context, and send a WhatsApp template message.
 * Shared by both workflowQueue and workflowService execution paths.
 */
export async function sendWhatsAppForOrder(
  templateKey: string,
  orderId: number,
  customLink?: string,
): Promise<{ messageLogId: number; providerMessageId?: string }> {
  if (!orderId) {
    throw new Error(`Cannot send WhatsApp: orderId is required (got ${orderId}). For manual workflow tests, provide an orderId in the input.`);
  }

  const templateConfig = ORDER_STATUS_TEMPLATES[templateKey];
  if (!templateConfig) {
    throw new Error(`Unknown WhatsApp template: ${templateKey}`);
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

  if (order.customer.whatsappOptOut) {
    logger.info('Skipping WhatsApp send — customer opted out', { orderId, customerId: order.customer.id });
    return { messageLogId: 0 };
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
    productName: [...new Set(order.orderItems
      ?.map((item: any) => item.product?.name)
      .filter(Boolean))]
      .join(', ') || undefined,
    status: order.status,
  };

  const bodyParams = templateConfig.bodyParams(orderContext);
  if (customLink) {
    bodyParams.push(customLink);
  }

  try {
    return await whatsappService.sendTemplate({
      to: orderContext.customerPhone,
      templateName: templateConfig.templateName,
      bodyParams,
      orderId: order.id,
      customerId: orderContext.customerId,
    });
  } catch (error: any) {
    // Auto-fallback to SMS when WhatsApp fails
    logger.warn('WhatsApp send failed, attempting SMS fallback', {
      orderId, templateKey, error: error.message,
    });

    try {
      const { sendSmsForOrder } = await import('./smsService');
      const smsResult = await sendSmsForOrder(templateKey, orderId);
      logger.info('SMS fallback succeeded', { orderId, messageLogId: smsResult.messageLogId });
      return smsResult;
    } catch (smsError: any) {
      logger.error('SMS fallback also failed', { orderId, error: smsError.message });
      throw error; // throw original WhatsApp error
    }
  }
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
 * Best-effort representation — the actual message sent uses Meta's template system.
 */
function buildMessageBody(templateName: string, bodyParams: string[]): string {
  const templates: Record<string, string> = {
    order_created: `Hi {1}, we've received your order {2}! Total: {3}. We'll confirm it shortly and keep you updated.`,
    order_confirmed: `Hi {1}, your order {2} has been confirmed! Total: {3}. We'll update you as it progresses.`,
    order_out_for_delivery: `Hi {1}, Your order {2} has been shipped and is on its way to you.`,
    order_delivered: `Hi {1}, your order {2} has been delivered! Visit {3} for your product guide. Thank you for your purchase!`,
    order_delivery_failed: `Hi {1}, we were unable to deliver your order {2}. We'll contact you to reschedule.`,
  };

  let body = templates[templateName] || `Template: ${templateName}`;
  bodyParams.forEach((param, i) => {
    body = body.replace(`{${i + 1}}`, param);
  });
  return body;
}

class WhatsAppService {
  /**
   * Send the API payload and update the MessageLog accordingly.
   * Shared by sendTemplate() and sendText().
   */
  private async dispatch(
    messageLogId: number,
    formattedPhone: string,
    payload: object,
  ): Promise<string | undefined> {
    let config = await getConfig();

    if (!config.accessToken || !config.phoneNumberId || !config.isEnabled) {
      logger.warn('WhatsApp not configured — message logged but not sent', { messageLogId });
      return undefined;
    }

    // On-demand token refresh for OAuth mode — only triggers when cron has failed
    // (within 1 day of expiry rather than 7, since cron handles proactive refresh)
    if (config.authMode === 'oauth' && config.oauthTokenExpiry) {
      const expiryMs = new Date(config.oauthTokenExpiry).getTime();
      const oneDay = 24 * 60 * 60 * 1000;
      if (expiryMs - Date.now() < oneDay) {
        try {
          const result = await refreshTokenIfNeeded();
          if (result.refreshed) {
            config = await getConfig(); // re-read so this dispatch uses the new token
          }
        } catch (err: any) {
          logger.warn('On-demand token refresh failed, proceeding with current token', { error: err.message });
        }
      }
    }

    try {
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
        where: { id: messageLogId },
        data: {
          status: MessageStatus.sent,
          providerMessageId,
          sentAt: new Date(),
        },
      });

      logger.info('WhatsApp message sent', { messageLogId, to: formattedPhone, providerMessageId });
      return providerMessageId;
    } catch (error: any) {
      await prisma.messageLog.update({
        where: { id: messageLogId },
        data: {
          status: MessageStatus.failed,
          errorMessage: error.message?.substring(0, 500),
        },
      });

      logger.error('Failed to send WhatsApp message', { messageLogId, error: error.message });
      throw error;
    }
  }

  /**
   * Send a template message via WhatsApp Business Cloud API.
   */
  async sendTemplate(options: SendTemplateOptions): Promise<{ messageLogId: number; providerMessageId?: string }> {
    const { to, templateName, languageCode = 'en_US', bodyParams = [], orderId, customerId } = options;
    const formattedPhone = formatPhoneNumber(to);
    const messageBody = buildMessageBody(templateName, bodyParams);

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

    const providerMessageId = await this.dispatch(messageLog.id, formattedPhone, payload);
    return { messageLogId: messageLog.id, providerMessageId };
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

    const payload = {
      messaging_product: 'whatsapp',
      to: formattedPhone,
      type: 'text',
      text: { body },
    };

    const providerMessageId = await this.dispatch(messageLog.id, formattedPhone, payload);
    return { messageLogId: messageLog.id, providerMessageId };
  }

  /**
   * Process inbound webhook status update from WhatsApp.
   * Updates MessageLog with delivery/read receipts in a single query.
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

    const updateData: Prisma.MessageLogUpdateManyMutationInput = { status: mappedStatus };
    const eventTime = timestamp ? new Date(timestamp * 1000) : new Date();

    if (mappedStatus === MessageStatus.delivered) {
      updateData.deliveredAt = eventTime;
    } else if (mappedStatus === MessageStatus.read) {
      updateData.readAt = eventTime;
    }

    const result = await prisma.messageLog.updateMany({
      where: { providerMessageId },
      data: updateData,
    });

    if (result.count === 0) {
      logger.warn('MessageLog not found for status update', { providerMessageId });
      return;
    }

    logger.info('WhatsApp message status updated', { providerMessageId, newStatus: mappedStatus });
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

    const where: Prisma.MessageLogWhereInput = {};
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
    const where: Prisma.MessageLogWhereInput = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [byStatus, byChannel] = await Promise.all([
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

    const total = byStatus.reduce((sum, s) => sum + s._count, 0);

    return {
      total,
      byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count])),
      byChannel: Object.fromEntries(byChannel.map(c => [c.channel, c._count])),
    };
  }
}

export const whatsappService = new WhatsAppService();
export default whatsappService;
