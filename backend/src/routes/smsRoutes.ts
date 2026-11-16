import { Router } from 'express';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { authenticate, requireRole } from '../middleware/auth';
import { handleArkeselWebhook, getStatus, testSend, disconnectSms } from '../controllers/smsController';

const router = Router();

// Public webhook for Arkesel delivery reports (no auth)
router.post('/webhook', handleArkeselWebhook);
// Arkesel's docs show the delivery report as a GET with query parameters
router.get('/webhook', handleArkeselWebhook);

// Admin-only endpoints
router.use(authenticate);
router.use(tenantRateLimiter);
router.get('/status', requireRole('super_admin', 'admin'), getStatus);
router.post('/test', requireRole('super_admin', 'admin'), testSend);
router.delete('/disconnect', requireRole('super_admin', 'admin'), disconnectSms);

export default router;
