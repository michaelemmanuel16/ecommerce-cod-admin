import { Router } from 'express';
import { getTeamReport } from '../controllers/reportController';
import { authenticate, requirePermission, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// F-1054: the team table lists every rep, so it is limited to owner, admin and manager. A sales rep reads their own
// numbers from GET /api/users/reps/performance, which the controller scopes to their id.
router.get('/team', requireResourcePermission('analytics', 'view'), requirePermission(['super_admin', 'admin', 'manager']), getTeamReport);

export default router;
