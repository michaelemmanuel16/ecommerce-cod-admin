import { Request, Response } from 'express';
import { smsService, getDbSmsConfig } from '../services/smsService';
import logger from '../utils/logger';

/**
 * Handle Arkesel delivery report webhook (public, no auth).
 */
export async function handleArkeselWebhook(req: Request, res: Response): Promise<void> {
  // Respond 200 immediately to acknowledge receipt
  res.status(200).json({ received: true });

  try {
    const { messageId, status } = req.body;
    if (messageId && status) {
      await smsService.processStatusUpdate(messageId, status);
    } else {
      logger.debug('Arkesel webhook: unrecognized payload', { body: req.body });
    }
  } catch (error: any) {
    logger.error('Error processing Arkesel webhook', { error: error.message });
  }
}

/**
 * Get SMS provider status (admin only).
 */
export async function getStatus(_req: Request, res: Response): Promise<void> {
  try {
    const config = await getDbSmsConfig();

    if (!config) {
      res.json({ configured: false, enabled: false });
      return;
    }

    res.json({
      configured: true,
      enabled: config.isEnabled,
      senderId: config.senderId,
      provider: 'arkesel',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * Send a test SMS (admin only).
 */
export async function testSend(req: Request, res: Response): Promise<void> {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      res.status(400).json({ error: 'phoneNumber is required' });
      return;
    }

    const result = await smsService.sendSms({
      to: phoneNumber,
      body: 'This is a test message from COD Admin. If you received this, SMS is configured correctly!',
    });

    res.json({
      success: true,
      messageLogId: result.messageLogId,
      providerMessageId: result.providerMessageId,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
