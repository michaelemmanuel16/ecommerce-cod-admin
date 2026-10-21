import { Router } from 'express';
import { getOwnerDashboard } from '../controllers/dashboardController';
import { authenticate, requireRole, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// M3-T09: the owner Dashboard. Owner (admin), super admin and manager see it (F-200); the manager's blocks are trimmed by permission (F-210).
router.get('/owner', requireRole('super_admin', 'admin', 'manager'), requireResourcePermission('analytics', 'view'), getOwnerDashboard);

export default router;
