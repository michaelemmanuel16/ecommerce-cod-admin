import { Router } from 'express';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import * as controller from '../controllers/leaderboardController';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// M6-T11 (F-1104, F-1105, F-1107, F-1109). The `targets:view` cell (every role has it). The service then shows the Owner, Admin and
// Manager every row and anyone else their own row only.
router.get('/', requireResourcePermission('targets', 'view'), controller.getLeaderboard);

export default router;
