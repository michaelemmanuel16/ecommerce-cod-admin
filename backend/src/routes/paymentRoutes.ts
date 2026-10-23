import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { publicVerifyLimiter } from '../middleware/rateLimiter';
import { handleWebhook, verifyPayment, publicVerifyPayment } from '../controllers/paystackController';

const router = Router();

// Provider-neutral payment routes (F-404). The provider comes from the path and is resolved from the registry.
// Raw body is preserved via the verify callback in server.ts (matches '/api/payments/webhook').
router.post('/webhook/:provider/:tenantSlug', handleWebhook);

// Public verification (used by the PaymentCallback page)
router.get('/verify/:reference', publicVerifyLimiter, publicVerifyPayment);

// Admin-only verification
router.get('/admin/verify/:reference', authenticate, requireRole('super_admin', 'admin'), verifyPayment);

export default router;
