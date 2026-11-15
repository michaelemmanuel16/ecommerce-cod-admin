import { Router } from 'express';
import { webhookLimiter } from '../middleware/rateLimiter';
import {
  findCustomerByUnsubscribeToken,
  optOutByUnsubscribeToken,
} from '../services/unsubscribeService';
import { escapeHtml } from '../utils/sanitizer';
import { MessageChannel } from '@prisma/client';
import logger from '../utils/logger';

/**
 * Public, unauthenticated email-unsubscribe routes (MAN-81), mounted at
 * /api/public/unsubscribe. The token is globally unique + random so lookups are
 * unscoped (no tenant context). Pages are minimal self-contained HTML.
 *
 * GET renders a confirm page and NEVER opts out — scanners/prefetchers auto-visit
 * links, and GET side effects are CSRF-able. POST performs the opt-out and also
 * serves the RFC 8058 one-click header (List-Unsubscribe-Post: List-Unsubscribe=One-Click).
 */

const router = Router();

router.use(webhookLimiter);

function page(title: string, bodyHtml: string): string {
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<meta name="robots" content="noindex" />' +
    `<title>${escapeHtml(title)}</title></head>` +
    '<body style="font-family:Arial,sans-serif;max-width:520px;margin:48px auto;padding:0 20px;color:#1f2937;text-align:center;">' +
    bodyHtml +
    '</body></html>'
  );
}

// One page for every token that does not belong to a customer: unknown, forged, or a customer who was deleted.
// It is the page a real unsubscribe shows, and it carries nothing about the store or a person (M9-T10).
const UNSUBSCRIBED_PAGE = page(
  'Unsubscribed',
  '<h2>You are unsubscribed</h2>' +
    "<p style=\"color:#6b7280;\">You won't receive further messages from this store. To start receiving them again, place a new order or contact the store.</p>",
);
const ERROR_PAGE = page('Unsubscribe', '<h2>Something went wrong</h2><p style="color:#6b7280;">Please try again later.</p>');

const CHANNELS = new Set<string>(['sms', 'whatsapp']);
const channelOf = (q: unknown): MessageChannel | undefined => (typeof q === 'string' && CHANNELS.has(q) ? (q as MessageChannel) : undefined);

// GET — render a confirm page only. No DB write.
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const customer = await findCustomerByUnsubscribeToken(token);
    if (!customer) {
      res.status(200).type('html').send(UNSUBSCRIBED_PAGE);
      return;
    }
    const channel = channelOf(req.query.channel);
    const action = `/api/public/unsubscribe/${encodeURIComponent(token)}${channel ? `?channel=${channel}` : ''}`;
    res
      .status(200)
      .type('html')
      .send(
        page(
          'Unsubscribe',
          '<h2>Unsubscribe from emails?</h2>' +
            "<p style=\"color:#6b7280;\">You'll stop receiving emails from this store.</p>" +
            `<form method="POST" action="${escapeHtml(action)}">` +
            '<button type="submit" style="background:#dc2626;color:#fff;border:none;padding:12px 28px;border-radius:8px;font-size:16px;cursor:pointer;">Confirm unsubscribe</button>' +
            '</form>',
        ),
      );
  } catch (error: any) {
    logger.error('Unsubscribe confirm page failed', { error: error.message });
    res.status(500).type('html').send(ERROR_PAGE);
  }
});

// POST — perform the opt-out. Serves both the confirm-page form submit and the
// RFC 8058 one-click header POST (body is ignored either way).
router.post('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    // Whether the token was real or not, the answer is the same page
    await optOutByUnsubscribeToken(token, channelOf(req.query.channel));
    res.status(200).type('html').send(UNSUBSCRIBED_PAGE);
  } catch (error: any) {
    logger.error('Unsubscribe opt-out failed', { error: error.message });
    res.status(500).type('html').send(ERROR_PAGE);
  }
});

export default router;
