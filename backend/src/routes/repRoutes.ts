import { Router } from 'express';
import { getTimeToFirstCall } from '../controllers/repStatsController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import {
  getRepOrders,
  getRepNumbers,
  getRepEarnings,
  getRepRewardProgress,
  getRepPayouts,
} from '../controllers/repController';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// M1-T22 (F-755). Controllers only parse the query; the number comes from services/kpi/timeToFirstCall.
router.get('/stats/time-to-first-call', requireResourcePermission('analytics', 'view'), getTimeToFirstCall);

// M7-T11 (COD-65): rep API part 2 (one path per endpoint)
router.get('/orders', requireResourcePermission('orders', 'view'), getRepOrders);
router.get('/numbers', requireResourcePermission('analytics', 'view'), getRepNumbers);
router.get('/earnings', requireResourcePermission('orders', 'view'), getRepEarnings);
router.get('/reward-progress', requireResourcePermission('targets', 'view'), getRepRewardProgress);
router.get('/payouts', requireResourcePermission('orders', 'view'), getRepPayouts);

export default router;
