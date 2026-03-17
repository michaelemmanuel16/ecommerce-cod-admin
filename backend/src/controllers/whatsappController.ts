import { Response } from 'express';
import { AuthRequest } from '../types';
import whatsappService, { TEMPLATE_BY_NAME } from '../services/whatsappService';
import logger from '../utils/logger';
import { MessageChannel, MessageStatus } from '@prisma/client';

/**
 * GET /api/whatsapp/webhook — WhatsApp webhook verification (challenge-response).
 * Public endpoint — no auth required.
 */
export const verifyWebhook = (req: AuthRequest, res: Response): void => {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === verifyToken) {
    logger.info('WhatsApp webhook verified');
    res.status(200).send(challenge);
  } else {
    logger.warn('WhatsApp webhook verification failed', { mode, tokenMatch: token === verifyToken });
    res.status(403).send('Forbidden');
  }
};

/**
 * POST /api/whatsapp/webhook — Receive WhatsApp status updates and inbound messages.
 * Public endpoint — no auth required. Validates via signature.
 */
export const handleWebhook = async (req: AuthRequest, res: Response): Promise<void> => {
  // Always respond 200 quickly to prevent WhatsApp retries
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;

    if (!body?.entry) return;

    for (const entry of body.entry) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;

        const value = change.value;

        // Process status updates (delivery receipts)
        for (const status of value.statuses || []) {
          await whatsappService.processStatusUpdate(
            status.id,
            status.status,
            status.timestamp ? parseInt(status.timestamp, 10) : undefined
          );
        }

        // Log inbound messages (for future reply handling)
        for (const message of value.messages || []) {
          logger.info('Inbound WhatsApp message received', {
            from: message.from,
            type: message.type,
            messageId: message.id,
          });
        }
      }
    }
  } catch (error: any) {
    logger.error('Error processing WhatsApp webhook', { error: error.message });
  }
};

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
 * POST /api/whatsapp/test — Send a test WhatsApp message.
 * Useful for verifying API credentials and template approval.
 * Admin-only.
 */
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
      totalAmount: 150.00,
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
