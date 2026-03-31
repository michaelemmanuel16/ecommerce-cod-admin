import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { handleWebhook, verifyPayment, publicVerifyPayment } from '../controllers/paystackController';

const router = Router();

// Webhook — raw body preserved via verify callback in server.ts for HMAC verification, no auth
router.post('/webhook', handleWebhook);

// Public verification (used by PaymentCallback page)
router.get('/verify/:reference', publicVerifyPayment);

// Admin-only verification
router.get('/admin/verify/:reference', authenticate, requireRole('super_admin', 'admin'), verifyPayment);

export default router;
