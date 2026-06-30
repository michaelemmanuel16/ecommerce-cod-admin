import { Router } from 'express';
import { webhookLimiter } from '../middleware/rateLimiter';
import {
  findCustomerByUnsubscribeToken,
  optOutByUnsubscribeToken,
} from '../services/unsubscribeService';
import { escapeHtml } from '../utils/sanitizer';
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

const INVALID_PAGE = page(
  'Unsubscribe',
  '<h2>Link not valid</h2>' +
    '<p style="color:#6b7280;">This unsubscribe link is invalid or has expired.</p>',
);

// GET — render a confirm page only. No DB write.
router.get('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const customer = await findCustomerByUnsubscribeToken(token);
    if (!customer) {
      res.status(404).type('html').send(INVALID_PAGE);
      return;
    }
    const action = `/api/public/unsubscribe/${encodeURIComponent(token)}`;
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
    res.status(500).type('html').send(INVALID_PAGE);
  }
});

// POST — perform the opt-out. Serves both the confirm-page form submit and the
// RFC 8058 one-click header POST (body is ignored either way).
router.post('/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const ok = await optOutByUnsubscribeToken(token);
    if (!ok) {
      res.status(404).type('html').send(INVALID_PAGE);
      return;
    }
    res
      .status(200)
      .type('html')
      .send(
        page(
          'Unsubscribed',
          "<h2>You've been unsubscribed</h2>" +
            "<p style=\"color:#6b7280;\">You won't receive further emails. To start receiving them again, place a new order or contact the store.</p>",
        ),
      );
  } catch (error: any) {
    logger.error('Unsubscribe opt-out failed', { error: error.message });
    res.status(500).type('html').send(INVALID_PAGE);
  }
});

export default router;
