import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../types';
import prisma from '../utils/prisma';
import { adminService } from '../services/adminService';
import { smsService, getDbSmsConfig, clearSmsConfigCache } from '../services/smsService';
import { arkeselSmsProvider } from '../services/messaging/providers';
import { messageStatus } from '../services/messaging/messageStatus';
import logger from '../utils/logger';
import { safeEqual } from '../utils/crypto';

let noTokenCalls = 0;

/**
 * Handle Arkesel delivery report webhook (public, no auth).
 * Arkesel reports carry the secret in the callback URL we send with each message: `?token=` must equal
 * ARKESEL_CALLBACK_TOKEN. In production a missing env var fails closed (401). In dev and test it is
 * accepted with a warning, and such events are never held for a later match.
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
  } else if (process.env.NODE_ENV === 'production') {
    if (noTokenCalls++ % 100 === 0) logger.error('ARKESEL_CALLBACK_TOKEN is not set: Arkesel delivery reports are refused');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  } else if (noTokenCalls++ % 100 === 0) {
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

/**
 * DELETE /api/sms/disconnect: clear the tenant's SMS (Arkesel) connection. Owner and admin only.
 * The card then shows "Not connected". Sent messages and their logs stay.
 */
export async function disconnectSms(req: AuthRequest, res: Response): Promise<void> {
  try {
    const config = await prisma.systemConfig.findFirst();
    if (!config) {
      res.status(500).json({ error: 'System config not found' });
      return;
    }

    await prisma.systemConfig.update({
      where: { id: config.id },
      data: { smsProvider: Prisma.DbNull },
    });
    clearSmsConfigCache();

    logger.info('SMS disconnected', { userId: req.user!.id });
    await adminService.createAuditLog(req.user!, 'disconnect', 'sms_provider', config.id.toString());

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to disconnect SMS', { error: error.message });
    res.status(500).json({ error: 'Failed to disconnect' });
  }
}
