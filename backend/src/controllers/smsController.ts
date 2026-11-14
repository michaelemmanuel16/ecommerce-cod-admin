import { Request, Response } from 'express';
import { smsService, getDbSmsConfig } from '../services/smsService';
import { arkeselSmsProvider } from '../services/messaging/providers';
import { messageStatus } from '../services/messaging/messageStatus';
import logger from '../utils/logger';
import { safeEqual } from '../utils/crypto';

let warnedNoCallbackToken = false;

/**
 * Handle Arkesel delivery report webhook (public, no auth).
 * Arkesel does not sign callbacks, so the callback URL carries a secret: `?token=` must equal
 * ARKESEL_CALLBACK_TOKEN. Without the env var, callbacks are still accepted (one warning), but
 * they are never held for a later match.
 */
export async function handleArkeselWebhook(req: Request, res: Response): Promise<void> {
  const expected = process.env.ARKESEL_CALLBACK_TOKEN;
  if (expected) {
    const given = typeof req.query.token === 'string' ? req.query.token : '';
    if (!given || !safeEqual(given, expected)) {
      logger.warn('Arkesel webhook: wrong or missing callback token');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  } else if (!warnedNoCallbackToken) {
    warnedNoCallbackToken = true;
    logger.warn('ARKESEL_CALLBACK_TOKEN is not set: Arkesel delivery reports are accepted without a secret');
  }

  // Respond 200 immediately to acknowledge receipt
  res.status(200).json({ received: true });

  try {
    const events = arkeselSmsProvider.parseStatusCallback(req);
    if (events.length === 0) {
      logger.debug('Arkesel webhook: unrecognized payload', { body: req.body });
    }
    for (const e of events) {
      await messageStatus.record(arkeselSmsProvider.name, e.providerMessageId, e.status, e.occurredAt, e.payload, {
        providerStatus: e.providerStatus,
        failureReason: e.failureReason,
        authenticated: !!expected,
      });
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

    const config = await getDbSmsConfig();
    if (!config || !config.isEnabled) {
      res.status(400).json({ error: 'SMS not configured or disabled' });
      return;
    }

    const result = await smsService.sendSms({
      to: phoneNumber,
      body: 'This is a test message from COD Admin. If you received this, SMS is configured correctly!',
    });

    if (!result.sent) {
      res.status(409).json({ error: 'SMS is not set up' });
      return;
    }

    res.json({
      success: true,
      messageLogId: result.messageLogId,
      providerMessageId: result.providerMessageId,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}
