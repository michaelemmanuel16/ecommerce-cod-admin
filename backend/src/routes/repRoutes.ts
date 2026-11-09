import { Router } from 'express';
import { getTimeToFirstCall } from '../controllers/repStatsController';
import * as repController from '../controllers/repController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// M1-T22 (F-755). Controllers only parse the query; the number comes from services/kpi/timeToFirstCall.
router.get('/stats/time-to-first-call', requireResourcePermission('analytics', 'view'), getTimeToFirstCall);

// M7-T10 (F-750, F-752, F-754, F-756) Rep API part 1
router.get('/me/summary', repController.getSummary);
router.get('/summary', repController.getSummary);

router.get('/me/today', repController.getToday);
router.get('/today', repController.getToday);

router.get('/me/queue', repController.getQueue);
router.get('/queue', repController.getQueue);

router.get('/orders/:id/card', repController.getCallCard);

export default router;
