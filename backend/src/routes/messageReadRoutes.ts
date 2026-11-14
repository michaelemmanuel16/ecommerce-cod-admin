import { Router } from 'express';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { authenticate, requireRole } from '../middleware/auth';
import * as ctrl from '../controllers/messageReadController';

// M9-T08: read side of /api/messages (figures and log). Mounted next to messageRoutes, which holds the actions.
const router = Router();
router.use(authenticate);
router.use(tenantRateLimiter);

// Owner, admin, manager see all; a rep sees the messages of their own orders and conversations (checked in the query)
const roles = ['super_admin', 'admin', 'manager', 'sales_rep'] as const;
router.get('/overview', requireRole(...roles), ctrl.getOverview);
router.get('/log', requireRole(...roles), ctrl.getLog);

export default router;
