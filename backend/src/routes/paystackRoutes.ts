import { Router } from 'express';
import express from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { handleWebhook, verifyPayment, publicVerifyPayment } from '../controllers/paystackController';

const router = Router();

// Webhook — must use raw body for HMAC verification, no auth
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

// Public verification (used by PaymentCallback page)
router.get('/verify/:reference', publicVerifyPayment);

// Admin-only verification
router.get('/admin/verify/:reference', authenticate, requireRole('super_admin', 'admin'), verifyPayment);

export default router;
