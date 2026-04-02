import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { testEmailSend } from '../controllers/emailController';

const router = Router();

// Admin-only endpoints
router.use(authenticate);
router.post('/test', requireRole('super_admin', 'admin'), testEmailSend);

export default router;
