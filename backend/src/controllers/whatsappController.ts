import { Response } from 'express';
import crypto from 'crypto';
import { safeEqual } from '../utils/crypto';
import { AuthRequest } from '../types';
import whatsappService, {
  TEMPLATE_BY_NAME,
  getDbWhatsappConfig,
  resolveWhatsappTenantFromPayload,
  findWhatsappConfigByVerifyToken,
} from '../services/whatsappService';
import { runInTenant } from '../utils/tenantContext';
import logger from '../utils/logger';
import { MessageChannel, MessageDirection, MessageStatus } from '@prisma/client';
import * as Money from '../utils/money';
import { phoneLookupVariants } from '../utils/phone';
import orderService from '../services/orderService';
import prisma from '../utils/prisma';

export const verifyWebhook = async (req: AuthRequest, res: Response): Promise<void> => {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  // The handshake carries no tenant: accept the token if any tenant's stored config
  // has it, or the env var
  const tenantMatch = mode === 'subscribe' ? await findWhatsappConfigByVerifyToken(token) : null;
  const verifyToken = tenantMatch?.config.webhookVerifyToken || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('WhatsApp webhook verified');
    res.set('Content-Type', 'text/plain').status(200).send(challenge);
  } else {
    logger.warn('WhatsApp webhook verification failed', { mode, tokenMatch: token === verifyToken });
    res.status(403).send('Forbidden');
  }
};

/**
 * Verify the X-Hub-Signature-256 header from Meta.
 * Uses HMAC-SHA256 with the app secret for constant-time comparison.
 */
function verifyWebhookSignature(rawBody: Buffer, signature: string | undefined, appSecret: string): boolean {
  if (!signature) return false;

  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const receivedHash = signature.startsWith('sha256=')
    ? signature.substring(7)
    : signature;

  return safeEqual(expectedHash, receivedHash);
}

/**
 * POST /api/whatsapp/webhook — Receive WhatsApp status updates and inbound messages.
 * Public endpoint — validates via X-Hub-Signature-256 HMAC signature.
 */
export const handleWebhook = async (req: AuthRequest, res: Response): Promise<void> => {
  // Resolve the tenant from the payload (phone_number_id / WABA id matched to a
  // tenant's stored WhatsApp config) BEFORE verifying: the signature is checked
  // with THAT tenant's app secret.
  const candidates = await resolveWhatsappTenantFromPayload(req.body);
  if (candidates.length === 0) {
    // 200 so Meta does not retry; nothing to process
    logger.warn('WhatsApp webhook: no tenant matches the payload, ignored');
    res.status(200).send('EVENT_RECEIVED');
    return;
  }
  // The signature decides: exactly one candidate's app secret must verify.
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const rawBody: Buffer | undefined = (req as any).rawBody;
  const verified = rawBody
    ? candidates.filter((c) => {
      const secret = c.config?.appSecret || process.env.WHATSAPP_APP_SECRET;
      return !!secret && verifyWebhookSignature(rawBody, signature, secret);
    })
    : [];
  if (verified.length !== 1) {
    if (candidates.length === 1) {
      logger.warn('WhatsApp webhook signature verification failed', { tenantId: candidates[0].tenantId });
      res.status(401).send('Unauthorized');
      return;
    }
    // Several tenants share the phone / WABA id and the signature does not pick one:
    // process nothing (200 so Meta does not retry)
    logger.error('WhatsApp webhook: several tenant configs match and the signature does not pick exactly one, ignored', {
      candidateTenantIds: candidates.map((c) => c.tenantId),
      verifiedCount: verified.length,
    });
    res.status(200).send('EVENT_RECEIVED');
    return;
  }
  const { tenantId, config: dbConfig } = verified[0];

  try {
    const body = req.body;

    if (!body?.entry) {
      res.status(200).send('EVENT_RECEIVED');
      return;
    }

    // Everything below runs inside the verified tenant's context
    await runInTenant(tenantId, async () => {
      for (const entry of body.entry) {
        for (const change of entry.changes || []) {
          if (change.field !== 'messages') continue;

          const value = change.value;

          // The signature only proves this tenant's secret: skip changes that belong to another phone number
          const phoneId = value?.metadata?.phone_number_id;
          if (phoneId && dbConfig?.phoneNumberId && String(phoneId) !== String(dbConfig.phoneNumberId)) {
            logger.warn('WhatsApp webhook: change for another phone number skipped', { tenantId, phoneId });
            continue;
          }

          // Process status updates (delivery receipts)
          for (const status of value.statuses || []) {
            await whatsappService.processStatusUpdate(
              status.id,
              status.status,
              status.timestamp ? parseInt(status.timestamp, 10) : undefined
            );
          }

          // Inbound messages (M7-T09)
          for (const message of value.messages || []) {
            await processInboundWhatsappMessage(tenantId, message);
          }
        }
      }
    });

    res.status(200).send('EVENT_RECEIVED');
  } catch (error: any) {
    logger.error('Error processing WhatsApp webhook', { error: error.message });
    res.status(200).send('EVENT_RECEIVED');
  }
};

/**
 * M7-T09: Process an inbound WhatsApp message.
 * - Idempotent by providerMessageId (message.id)
 * - Links to customer by phone (unknown number stored, not dropped)
 * - Links to message it answers (message.context.id)
 * - Keywords YES/NO: YES confirms order via confirmByCustomer; NO sets saidNo and requiresManualCall
 * - Stores message in MessageLog with direction: inbound
 */
async function processInboundWhatsappMessage(tenantId: string, message: any): Promise<void> {
  // Idempotency check: duplicate webhook delivery is ignored
  if (message.id) {
    const existing = await prisma.messageLog.findFirst({
      where: { providerMessageId: message.id },
    });
    if (existing) {
      logger.info('Duplicate WhatsApp webhook message ignored', { messageId: message.id });
      return;
    }
  }

  const fromPhone = message.from;
  let responseKind: 'yes' | 'change' | 'cancel' | 'no' | null = null;

  // Read button payload first (COD-193 M7-R1)
  let buttonPayload: string | null = null;
  if (message.type === 'button') {
    buttonPayload = message.button?.payload || null;
  } else if (message.type === 'interactive') {
    buttonPayload = message.interactive?.button_reply?.id || null;
  }

  if (buttonPayload) {
    if (buttonPayload === 'CONFIRM') responseKind = 'yes';
    else if (buttonPayload === 'CHANGE') responseKind = 'change';
    else if (buttonPayload === 'CANCEL') responseKind = 'cancel';
  }

  let rawText = '';
  if (message.type === 'text') {
    rawText = message.text?.body || '';
  } else if (message.type === 'button') {
    rawText = message.button?.text || '';
  } else if (message.type === 'interactive') {
    rawText = message.interactive?.button_reply?.title || '';
  }

  const trimmed = rawText.trim();
  // Strip trailing and leading punctuation: "YES.", "Yes!", "NO."
  const cleanText = trimmed.replace(/^[\s.,!?;:"'()]+|[\s.,!?;:"'()]+$/g, '').toLowerCase();

  if (!responseKind) {
    if (cleanText === 'yes' || cleanText === 'y' || cleanText === 'confirm') {
      responseKind = 'yes';
    } else if (cleanText === 'no' || cleanText === 'n' || cleanText === 'cancel') {
      responseKind = 'no';
    }
  }

  // Link to customer by phone
  let customer: any = null;
  if (fromPhone) {
    const rawNoPlus = fromPhone.replace(/^\+/, '');
    const rawPlus = `+${rawNoPlus}`;
    const variants = Array.from(new Set([
      fromPhone,
      rawNoPlus,
      rawPlus,
      ...phoneLookupVariants(fromPhone),
      ...phoneLookupVariants(rawPlus),
    ]));
    customer = await prisma.customer.findFirst({
      where: {
        tenantId,
        OR: [
          { phoneNumber: { in: variants } },
          { alternatePhone: { in: variants } },
        ],
      },
    });
  }

  // Link to the message it answers (if context exists)
  let answeredMessage: any = null;
  if (message.context?.id) {
    answeredMessage = await prisma.messageLog.findFirst({
      where: { providerMessageId: message.context.id },
    });
  }

  if (!customer && answeredMessage?.customerId) {
    customer = await prisma.customer.findFirst({
      where: { tenantId, id: answeredMessage.customerId },
    });
  }

  // Store first: create the MessageLog row before any order change
  // providerMessageId is unique: on Prisma P2002, log duplicate and return
  let createdLog: any = null;
  try {
    createdLog = await prisma.messageLog.create({
      data: {
        tenantId,
        customerId: customer?.id ?? answeredMessage?.customerId ?? null,
        orderId: null,
        channel: MessageChannel.whatsapp,
        direction: MessageDirection.inbound,
        status: MessageStatus.delivered,
        messageBody: trimmed || buttonPayload || `[${message.type || 'message'}]`,
        providerMessageId: message.id || null,
        metadata: {
          from: fromPhone,
          type: message.type,
          context: message.context ?? null,
          answeredMessageLogId: answeredMessage?.id ?? null,
          matchedKeyword: responseKind,
        },
      },
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      logger.info('Duplicate WhatsApp webhook message ignored', { messageId: message.id });
      return;
    }
    throw err;
  }

  // Resolve target order
  let targetOrder: any = null;
  if (answeredMessage?.orderId) {
    targetOrder = await prisma.order.findFirst({
      where: {
        tenantId,
        id: answeredMessage.orderId,
        deletedAt: null,
      },
      include: { customer: true },
    });
  } else if (customer) {
    // First: open auto-confirm order
    targetOrder = await prisma.order.findFirst({
      where: {
        tenantId,
        customerId: customer.id,
        status: 'pending_confirmation',
        autoConfirmSentAt: { not: null },
        customerResponse: null,
        deletedAt: null,
      },
      include: { customer: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Handle auto-confirm responses
  // Acts only on an open auto-confirm: status pending_confirmation and autoConfirmSentAt not null.
  if (targetOrder && targetOrder.status === 'pending_confirmation' && targetOrder.autoConfirmSentAt !== null && responseKind) {
    const firstName = targetOrder.customer?.firstName || customer?.firstName || 'there';

    if (responseKind === 'yes') {
      await orderService.confirmByCustomer(targetOrder.id);
      await prisma.confirmToken.updateMany({
        where: { orderId: targetOrder.id, usedAt: null },
        data: { usedAt: new Date(), response: 'yes' },
      });
      try {
        await whatsappService.sendText({
          to: fromPhone,
          body: `Thank you, ${firstName}. Your order #${targetOrder.id} is confirmed. We will send it out for delivery.`,
          orderId: targetOrder.id,
          customerId: targetOrder.customer?.id ?? customer?.id,
        });
      } catch (err: any) {
        logger.error('Failed to send confirmation reply WhatsApp message', { error: err.message, orderId: targetOrder.id });
      }
    } else if (responseKind === 'change') {
      await prisma.order.update({
        where: { id: targetOrder.id },
        data: {
          saidNo: true,
          requiresManualCall: true,
          customerResponse: 'change',
        },
      });
      await prisma.confirmToken.updateMany({
        where: { orderId: targetOrder.id, usedAt: null },
        data: { usedAt: new Date(), response: 'change' },
      });
      try {
        await whatsappService.sendText({
          to: fromPhone,
          body: `Thank you, ${firstName}. One of our team will call you soon to make the change.`,
          orderId: targetOrder.id,
          customerId: targetOrder.customer?.id ?? customer?.id,
        });
      } catch (err: any) {
        logger.error('Failed to send change reply WhatsApp message', { error: err.message, orderId: targetOrder.id });
      }
    } else if (responseKind === 'cancel') {
      await prisma.order.update({
        where: { id: targetOrder.id },
        data: {
          saidNo: true,
          requiresManualCall: true,
          customerResponse: 'cancel',
        },
      });
      await prisma.confirmToken.updateMany({
        where: { orderId: targetOrder.id, usedAt: null },
        data: { usedAt: new Date(), response: 'cancel' },
      });
      try {
        await whatsappService.sendText({
          to: fromPhone,
          body: `Thank you, ${firstName}. One of our team will call you shortly about your order.`,
          orderId: targetOrder.id,
          customerId: targetOrder.customer?.id ?? customer?.id,
        });
      } catch (err: any) {
        logger.error('Failed to send cancel reply WhatsApp message', { error: err.message, orderId: targetOrder.id });
      }
    } else if (responseKind === 'no') {
      await prisma.order.update({
        where: { id: targetOrder.id },
        data: {
          saidNo: true,
          requiresManualCall: true,
          customerResponse: 'no',
        },
      });
      await prisma.confirmToken.updateMany({
        where: { orderId: targetOrder.id, usedAt: null },
        data: { usedAt: new Date(), response: 'no' },
      });
    }
  }

  // After the order step, update that row's orderId if an order was found
  const resolvedOrderId = targetOrder?.id ?? answeredMessage?.orderId ?? null;
  if (resolvedOrderId && createdLog?.id) {
    await prisma.messageLog.update({
      where: { id: createdLog.id },
      data: { orderId: resolvedOrderId },
    });
  }
}

/**
 * GET /api/whatsapp/messages — List message logs with filters.
 * Requires admin auth.
 */
export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      page, limit, channel, status, orderId, customerId, startDate, endDate,
    } = req.query;

    const result = await whatsappService.getMessages({
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      channel: channel as MessageChannel | undefined,
      status: status as MessageStatus | undefined,
      orderId: orderId ? parseInt(orderId as string, 10) : undefined,
      customerId: customerId ? parseInt(customerId as string, 10) : undefined,
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    });

    res.json(result);
  } catch (error: any) {
    logger.error('Error fetching messages', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
};

/**
 * GET /api/whatsapp/messages/:id — Get single message log.
 */
export const getMessageById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const message = await whatsappService.getMessageById(id);

    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    res.json(message);
  } catch (error: any) {
    logger.error('Error fetching message', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch message' });
  }
};

/**
 * POST /api/whatsapp/send — Manually send a WhatsApp message.
 * Requires admin auth.
 */
export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { to, body, orderId, customerId } = req.body;

    if (!to || !body) {
      res.status(400).json({ error: 'Missing required fields: to, body' });
      return;
    }

    const result = await whatsappService.sendText({
      to,
      body,
      orderId: orderId ? parseInt(orderId, 10) : undefined,
      customerId: customerId ? parseInt(customerId, 10) : undefined,
    });

    res.status(201).json(result);
  } catch (error: any) {
    logger.error('Error sending WhatsApp message', { error: error.message });
    res.status(500).json({ error: 'Failed to send message' });
  }
};

/**
 * GET /api/whatsapp/stats — Message delivery statistics.
 */
export const getStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query;
    const stats = await whatsappService.getStats(
      startDate as string | undefined,
      endDate as string | undefined,
    );
    res.json(stats);
  } catch (error: any) {
    logger.error('Error fetching message stats', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
};

/**
 * GET /api/whatsapp/status — Check WhatsApp connection status.
 * Admin-only. Validates credentials against Meta Graph API.
 */
export const getStatus = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const dbConfig = await getDbWhatsappConfig();
    const accessToken = dbConfig?.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || '';
    const phoneNumberId = dbConfig?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const isEnabled = dbConfig?.isEnabled !== false;

    if (!accessToken || !phoneNumberId) {
      res.json({ configured: false, enabled: false });
      return;
    }

    // Call Meta Graph API to validate credentials
    try {
      const response = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!response.ok) {
        logger.error(`WhatsApp API status check failed: ${response.status}`);
        res.json({
          configured: true,
          enabled: isEnabled,
          error: `WhatsApp API returned status ${response.status}`,
        });
        return;
      }

      const data = await response.json() as {
        verified_name?: string;
        display_phone_number?: string;
        quality_rating?: string;
      };

      res.json({
        configured: true,
        enabled: isEnabled,
        verifiedName: data.verified_name,
        displayPhoneNumber: data.display_phone_number,
        qualityRating: data.quality_rating,
      });
    } catch (fetchError: any) {
      res.json({
        configured: true,
        enabled: isEnabled,
        error: fetchError.message,
      });
    }
  } catch (error: any) {
    logger.error('Error checking WhatsApp status', { error: error.message });
    res.status(500).json({ error: 'Failed to check WhatsApp status' });
  }
};

export const testSend = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { to, templateName } = req.body;

    if (!to) {
      res.status(400).json({ error: 'Missing required field: to (phone number)' });
      return;
    }

    const template = templateName || 'order_confirmed';
    const templateConfig = TEMPLATE_BY_NAME[template];

    if (!templateConfig) {
      res.status(400).json({
        error: `Unknown template: ${template}`,
        availableTemplates: Object.keys(TEMPLATE_BY_NAME),
      });
      return;
    }

    // Use dummy order context for test
    const dummyContext = {
      orderId: 12345,
      customerId: 0,
      customerName: 'Test Customer',
      customerPhone: to,
      totalAmount: Money.parse('150.00'),
      deliveryAgentName: 'Test Agent',
      status: 'confirmed',
    };

    const result = await whatsappService.sendTemplate({
      to,
      templateName: templateConfig.templateName,
      bodyParams: templateConfig.bodyParams(dummyContext),
    });

    res.status(200).json({
      success: true,
      message: 'Test message sent (check MessageLog for delivery status)',
      ...result,
    });
  } catch (error: any) {
    logger.error('Error sending test WhatsApp message', { error: error.message });
    res.status(500).json({ error: `Failed to send test message: ${error.message}` });
  }
};
