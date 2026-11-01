import { Router } from 'express';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import * as rewardController from '../controllers/rewardController';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// M6-T09 (F-1231, F-1110). The Rewards tab is a settings tab: the `settings` cells (Owner edits; Owner and Admin read).
// Attainment has no permission cell of its own: the service shows everyone to the Owner, Admin and Manager level and a
// person their own rows (F-1108).
router.get('/settings', requireResourcePermission('settings', 'view'), rewardController.getSettings);
router.put('/settings', requireResourcePermission('settings', 'update'), rewardController.putSettings);
router.get('/attainment', rewardController.getAttainment);

export default router;
