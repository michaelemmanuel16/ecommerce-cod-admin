import { Router } from 'express';
import { getTimeToFirstCall } from '../controllers/repStatsController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import {
  getSummary,
  getToday,
  getQueue,
  getCallCard,
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

// M7-T10 (F-750, F-752, F-754, F-756) Rep API part 1
router.get('/summary', requireResourcePermission('orders', 'view'), getSummary);
router.get('/today', requireResourcePermission('analytics', 'view'), getToday);
router.get('/queue', requireResourcePermission('orders', 'view'), getQueue);
router.get('/orders/:id/card', requireResourcePermission('orders', 'view'), getCallCard);

// M7-T11 (COD-65): rep API part 2 (one path per endpoint)
router.get('/orders', requireResourcePermission('orders', 'view'), getRepOrders);
router.get('/numbers', requireResourcePermission('analytics', 'view'), getRepNumbers);
router.get('/earnings', requireResourcePermission('orders', 'view'), getRepEarnings);
router.get('/reward-progress', requireResourcePermission('targets', 'view'), getRepRewardProgress);
router.get('/payouts', requireResourcePermission('orders', 'view'), getRepPayouts);

export default router;
