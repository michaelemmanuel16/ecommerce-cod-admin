import { Router } from 'express';
import { getTimeToFirstCall } from '../controllers/repStatsController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

const router = Router();

// M1-T22 (F-755). Controllers only parse the query; the number comes from services/kpi/timeToFirstCall.
router.use(authenticate);
router.use(tenantRateLimiter);

router.get('/stats/time-to-first-call', requireResourcePermission('analytics', 'view'), getTimeToFirstCall);

export default router;
