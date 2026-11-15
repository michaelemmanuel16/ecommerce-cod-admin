import { Router } from 'express';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { authenticate, requireRole } from '../middleware/auth';
import * as ctrl from '../controllers/messageActionsController';

const router = Router();
router.use(authenticate);
router.use(tenantRateLimiter);

// Owner, admin, manager, and a sales rep for a message on their own order (checked in the service)
const roles = ['super_admin', 'admin', 'manager', 'sales_rep'] as const;
router.post('/:id/retry', requireRole(...roles), ctrl.retry);
router.post('/:id/resend-sms', requireRole(...roles), ctrl.resendSms);

export default router;
