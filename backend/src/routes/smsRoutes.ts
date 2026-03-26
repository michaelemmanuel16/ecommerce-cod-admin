import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { handleArkeselWebhook, getStatus, testSend } from '../controllers/smsController';

const router = Router();

// Public webhook for Arkesel delivery reports (no auth)
router.post('/webhook', handleArkeselWebhook);

// Admin-only endpoints
router.use(authenticate);
router.get('/status', requireRole('super_admin', 'admin'), getStatus);
router.post('/test', requireRole('super_admin', 'admin'), testSend);

export default router;
