import { Request, Response } from 'express';
import { sendTestEmail, clearEmailConfigCache } from '../services/emailService';
import logger from '../utils/logger';

/**
 * Send a test email to verify configuration (admin only).
 */
export async function testEmailSend(req: Request, res: Response): Promise<void> {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'email is required' });
      return;
    }

    // Clear cache so we use the latest saved settings
    clearEmailConfigCache();

    await sendTestEmail(email);
    res.json({ success: true, message: `Test email sent to ${email}` });
  } catch (error: any) {
    logger.error('Test email failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
}
