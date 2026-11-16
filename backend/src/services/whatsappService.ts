import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { MessageChannel, Prisma, MessageStatus } from '@prisma/client';
import { decryptProviderSecrets } from '../utils/providerCrypto';
import { getTenantId, withoutTenant } from '../utils/tenantContext';
import * as Money from '../utils/money';
import { getStoreTimeZone, parseInclusiveBound } from './kpi/dates';
import { formatOrderNumber } from '../utils/orderNumber';
import { messageSender, throwIfFailed } from './messaging/messageSender';

// The WhatsApp Cloud adapter owns the provider call and its config
export { getDbWhatsappConfig, clearWhatsAppConfigCache } from './messaging/providers/whatsappCloudProvider';

/**
 * Every tenant's decrypted WhatsApp config, read unscoped on purpose: the Meta
 * webhook carries no tenant, so we match it to a tenant by its stored config.
 */
async function listTenantWhatsappConfigs(): Promise<Array<{ tenantId: string; config: any }>> {
  const rows = await withoutTenant('whatsapp-webhook-tenant', () =>
    prisma.systemConfig.findMany({
      where: { tenantId: { not: null } },
      select: { tenantId: true, whatsappProvider: true },
    })
  );
  const result: Array<{ tenantId: string; config: any }> = [];
  for (const row of rows) {
    if (!row.tenantId || !row.whatsappProvider) continue;
    try {
      result.push({ tenantId: row.tenantId, config: decryptProviderSecrets('whatsappProvider', row.whatsappProvider as any) });
    } catch (error: any) {
      logger.warn('Skipping unreadable WhatsApp config while resolving webhook tenant', { tenantId: row.tenantId, error: error.message });
    }
  }
  return result;
}

/**
 * Find the tenant that owns an inbound Meta webhook payload: phone_number_id first,
 * then the WABA id (entry.id), matched against each tenant's stored WhatsApp config.
 * Returns every matching tenant config (empty when none match). More than one can
 * match: the caller must tell them apart (the controller checks the payload signature
 * against each candidate's app secret).
 */
export async function resolveWhatsappTenantFromPayload(
  body: any,
): Promise<Array<{ tenantId: string; config: any }>> {
  const phoneIds = new Set<string>();
  const wabaIds = new Set<string>();
  for (const entry of body?.entry || []) {
    if (entry?.id) wabaIds.add(String(entry.id));
    for (const change of entry?.changes || []) {
      const phoneId = change?.value?.metadata?.phone_number_id;
      if (phoneId) phoneIds.add(String(phoneId));
    }
  }
  if (phoneIds.size === 0 && wabaIds.size === 0) return [];

  const configs = await listTenantWhatsappConfigs();
  const byPhone = configs.filter((c) => c.config?.phoneNumberId && phoneIds.has(String(c.config.phoneNumberId)));
  if (byPhone.length > 0) return byPhone;
  return configs.filter((c) => c.config?.wabaId && wabaIds.has(String(c.config.wabaId)));
}

/** Find the tenant whose stored webhook verify token matches (Meta's GET handshake). */
export async function findWhatsappConfigByVerifyToken(
  token: string,
): Promise<{ tenantId: string; config: any } | null> {
  if (!token) return null;
  const configs = await listTenantWhatsappConfigs();
  return configs.find((c) => c.config?.webhookVerifyToken && c.config.webhookVerifyToken === token) ?? null;
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
    bodyParams: (o) => [o.customerName, formatOrderNumber(o.orderId)],
  },
  confirmed: {
    templateName: 'order_confirmed',
    bodyParams: (o) => [o.customerName, formatOrderNumber(o.orderId)],
  },
  out_for_delivery: {
    templateName: 'order_out_for_delivery',
    bodyParams: (o) => [o.customerName, `${formatOrderNumber(o.orderId)}, ${o.productName || 'your items'}`],
  },
  delivered: {
    templateName: 'order_delivered',
    bodyParams: (o) => [o.customerName, `${formatOrderNumber(o.orderId)}, ${o.productName || 'your items'}`],
  },
  failed_delivery: {
    templateName: 'order_delivery_failed',
    bodyParams: (o) => [o.customerName, formatOrderNumber(o.orderId)],
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
  totalAmount: Money.Money;
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
): Promise<{ messageLogId: number; providerMessageId?: string; sent?: boolean }> {
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
    totalAmount: Money.parse(order.totalAmount),
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
      const smsResult = await sendSmsForOrder(templateKey, orderId, error.messageLogId);
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
  /** The template text with {{1}} placeholders, from the MessageTemplate row. The log keeps it filled in. */
  bodyText?: string;
  templateName: string;
  languageCode?: string;
  bodyParams?: string[];
  headerParams?: string[];
  buttonPayloads?: string[];
  orderId?: number;
  customerId?: number;
  conversationId?: number;
  inReplyToId?: number;
  retryOfId?: number;
  /** Only replyToConversation sets this: it did its own window and opt-out check. */
  optOutCheckedByCaller?: boolean;
}

interface SendTextOptions {
  to: string;
  body: string;
  /** What the message log keeps instead of `body` (a text with a secret link). WhatsApp still gets `body`. */
  logBody?: string;
  orderId?: number;
  customerId?: number;
  conversationId?: number;
  inReplyToId?: number;
  retryOfId?: number;
  /** Only replyToConversation sets this: it did its own window and opt-out check. */
  optOutCheckedByCaller?: boolean;
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
function buildMessageBody(templateName: string, bodyParams: string[], bodyText?: string): string {
  const templates: Record<string, string> = {
    order_created: `Hi {1}, we've received your order {2}! Total: {3}. We'll confirm it shortly and keep you updated.`,
    order_confirmed: `Hi {1}, your order {2} has been confirmed! Total: {3}. We'll update you as it progresses.`,
    order_out_for_delivery: `Hi {1}, Your order {2} has been shipped and is on its way to you.`,
    order_delivered: `Hi {1}, your order {2} has been delivered! Visit {3} for your product guide. Thank you for your purchase!`,
    order_delivery_failed: `Hi {1}, we were unable to deliver your order {2}. We'll contact you to reschedule.`,
    order_auto_confirm: `Hello {1},\n\nThank you for your order.\n\n*Package:* {2}\n*Order number:* #{3}\n*Pay on delivery:* {4}\n\nPlease confirm your order so we can send it out for delivery.`,
  };

  let body = bodyText ?? (templates[templateName] || `Template: ${templateName}`);
  bodyParams.forEach((param, i) => {
    // {{n}} and {n} in one pass: replacing {n} first would eat the inner braces of {{n}} and leave '{Manny}'
    body = body.replace(new RegExp(`\\{\\{${i + 1}\\}\\}|\\{${i + 1}\\}`), () => param);
  });
  return body;
}

class WhatsAppService {
  /**
   * Send a template message via WhatsApp Business Cloud API.
   */
  async sendTemplate(options: SendTemplateOptions): Promise<{ messageLogId: number; providerMessageId?: string; sent: boolean; skipped?: boolean }> {
    const {
      to,
      bodyText,
      templateName,
      languageCode = 'en_US',
      bodyParams = [],
      headerParams = [],
      buttonPayloads = [],
      orderId,
      customerId,
      conversationId,
      inReplyToId,
      retryOfId,
      optOutCheckedByCaller,
    } = options;
    const formattedPhone = formatPhoneNumber(to);

    const result = await messageSender.send({
      tenantId: getTenantId(),
      channel: MessageChannel.whatsapp,
      to: formattedPhone,
      template: { name: templateName, languageCode, bodyParams, headerParams, buttonPayloads },
      logBody: buildMessageBody(templateName, bodyParams, bodyText),
      orderId,
      customerId,
      conversationId,
      inReplyToId,
      retryOfId,
      optOutCheckedByCaller,
      metadata: { bodyParams, headerParams, buttonPayloads, languageCode },
    });
    throwIfFailed(result);
    return { messageLogId: result.messageLogId, providerMessageId: result.providerMessageId, sent: result.sent, ...(result.skipped ? { skipped: true } : {}) };
  }

  /**
   * Send a free-form text message via WhatsApp.
   */
  async sendText(options: SendTextOptions): Promise<{ messageLogId: number; providerMessageId?: string; sent: boolean; skipped?: boolean }> {
    const { to, body, logBody, orderId, customerId, conversationId, inReplyToId, retryOfId, optOutCheckedByCaller } = options;

    const result = await messageSender.send({
      tenantId: getTenantId(),
      channel: MessageChannel.whatsapp,
      to: formatPhoneNumber(to),
      body,
      logBody,
      orderId,
      customerId,
      conversationId,
      inReplyToId,
      retryOfId,
      optOutCheckedByCaller,
    });
    throwIfFailed(result);
    return { messageLogId: result.messageLogId, providerMessageId: result.providerMessageId, sent: result.sent, ...(result.skipped ? { skipped: true } : {}) };
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
      const zone = getStoreTimeZone(getTenantId());
      if (startDate) where.createdAt.gte = parseInclusiveBound(startDate, 'from', zone);
      if (endDate) where.createdAt.lte = parseInclusiveBound(endDate, 'to', zone);
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
      const zone = getStoreTimeZone(getTenantId());
      if (startDate) where.createdAt.gte = parseInclusiveBound(startDate, 'from', zone);
      if (endDate) where.createdAt.lte = parseInclusiveBound(endDate, 'to', zone);
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
