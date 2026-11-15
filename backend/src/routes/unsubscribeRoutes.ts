import { Router } from 'express';
import { webhookLimiter } from '../middleware/rateLimiter';
import {
  DEFAULT_BRAND_COLOR,
  findCustomerByUnsubscribeToken,
  getStoreBrand,
  optOutByUnsubscribeToken,
  type StoreBrand,
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

/** Black or white, whichever reads on the colour (WCAG relative luminance). */
function textOn(hex: string): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.4 ? '#111827' : '#ffffff';
}

const NEUTRAL: StoreBrand = { name: null, logo: null, color: DEFAULT_BRAND_COLOR };

/** One small page that works at 360 px: the store's name (and logo) on top, the message in a card, one full-width button. */
function page(title: string, bodyHtml: string, brand: StoreBrand = NEUTRAL): string {
  const header =
    (brand.logo ? `<img src="${escapeHtml(brand.logo)}" alt="" style="max-height:44px;max-width:160px;display:block;margin:0 auto 8px;" />` : '') +
    (brand.name ? `<div class="store">${escapeHtml(brand.name)}</div>` : '');
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
    '<meta name="robots" content="noindex" />' +
    `<title>${escapeHtml(brand.name ? `${title} - ${brand.name}` : title)}</title>` +
    '<style>' +
    '*{box-sizing:border-box}' +
    'body{margin:0;min-height:100vh;background:#f5f6f8;font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#1f2937;line-height:1.5;-webkit-text-size-adjust:100%}' +
    `main{max-width:440px;margin:0 auto;padding:28px 16px}` +
    `.store{font-size:20px;font-weight:700;text-align:center;color:${brand.color};margin-bottom:16px}` +
    `.card{background:#fff;border:1px solid #e5e7eb;border-top:4px solid ${brand.color};border-radius:14px;padding:28px 22px;text-align:center}` +
    'h1{font-size:22px;line-height:1.25;margin:0 0 10px}' +
    'p{margin:0 0 18px;color:#4b5563;font-size:16px}' +
    `button{width:100%;min-height:48px;border:0;border-radius:10px;background:${brand.color};color:${textOn(brand.color)};font:inherit;font-size:16px;font-weight:600;cursor:pointer}` +
    'button:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}' +
    '</style></head>' +
    `<body><main>${header}<div class="card">${bodyHtml}</div></main></body></html>`
  );
}

// One page for every token that does not belong to a customer: unknown, forged, or a customer who was deleted.
// It is the page a real unsubscribe shows, and it carries nothing about the store or a person (M9-T10): the store look
// is on the confirm page only, which a real token alone reaches.
const UNSUBSCRIBED_PAGE = page(
  'Unsubscribed',
  '<h1>You are unsubscribed</h1>' +
    "<p>You won't receive further messages from this store. To start receiving them again, place a new order or contact the store.</p>",
);
const ERROR_PAGE = page('Unsubscribe', '<h1>Something went wrong</h1><p>Please try again later.</p>');

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
    const brand = await getStoreBrand(customer.tenantId).catch(() => NEUTRAL);
    const what = channel === 'sms' ? 'emails and SMS' : channel === 'whatsapp' ? 'emails and WhatsApp messages' : 'emails';
    const from = brand.name ?? 'this store';
    res
      .status(200)
      .type('html')
      .send(
        page(
          'Unsubscribe',
          '<h1>Stop receiving messages?</h1>' +
            `<p>You will stop getting ${what} from ${escapeHtml(from)}.</p>` +
            `<form method="POST" action="${escapeHtml(action)}">` +
            '<button type="submit">Confirm unsubscribe</button>' +
            '</form>',
          brand,
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
