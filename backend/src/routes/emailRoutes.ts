import { Router } from 'express';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { authenticate, requireRole } from '../middleware/auth';
import { testEmailSend } from '../controllers/emailController';

const router = Router();

// Admin-only endpoints
router.use(authenticate);
router.use(tenantRateLimiter);
router.post('/test', requireRole('super_admin', 'admin'), testEmailSend);

export default router;
