import { Router } from 'express';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import * as controller from '../controllers/leaderboardController';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// M6-T11 (F-1109): read only. Badges are written by the month close and never by hand.
router.get('/', requireResourcePermission('targets', 'view'), controller.getBadges);

export default router;
