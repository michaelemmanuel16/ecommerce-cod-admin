import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  handleWebhook,
  handleLegacyWebhook,
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

// Legacy unscoped webhook → 410 Gone. Tenants must update their Paystack
// dashboard to the per-tenant URL.
router.post('/webhook', handleLegacyWebhook);

// Per-tenant webhook — raw body preserved via verify callback in server.ts.
// Slug → tenant lookup → HMAC verified with that tenant's secret.
router.post('/webhook/:tenantSlug', handleWebhook);

// Public verification (used by PaymentCallback page)
router.get('/verify/:reference', publicVerifyPayment);

// Admin-only verification
router.get('/admin/verify/:reference', authenticate, requireRole('super_admin', 'admin'), verifyPayment);

export default router;
