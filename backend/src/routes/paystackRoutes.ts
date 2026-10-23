import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  handleWebhook,
  verifyPayment,
  publicVerifyPayment,
} from '../controllers/paystackController';
import { handlePlatformWebhook } from '../controllers/platformBillingWebhookController';

const router = Router();

// Platform SaaS-subscription webhook (MAN-61) — CodAdmin's OWN Paystack account,
// distinct from the per-tenant buyer webhook below. HMAC verified with the
// platform secret; tenant resolved from the payload. Raw body preserved via the
// verify callback in server.ts (which matches '/api/paystack/platform-webhook').
router.post('/platform-webhook', handlePlatformWebhook);

// Old per-tenant webhook URL, kept as an alias of POST /api/payments/webhook/paystack/:tenantSlug
// (tenants have it saved in their Paystack dashboard). Same handler. Raw body preserved via verify callback in server.ts.
// Slug → tenant lookup → HMAC verified with that tenant's secret.
router.post('/webhook/:tenantSlug', handleWebhook);

// Old verify paths, aliases of /api/payments/verify and /api/payments/admin/verify.
// Public verification (used by PaymentCallback page)
router.get('/verify/:reference', publicVerifyPayment);

// Admin-only verification
router.get('/admin/verify/:reference', authenticate, requireRole('super_admin', 'admin'), verifyPayment);

export default router;
