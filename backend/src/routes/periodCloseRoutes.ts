import { Router } from 'express';
import { authenticate, requireResourcePermission, requireSuperAdmin } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import * as periodCloseController from '../controllers/periodCloseController';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// M6-T10 (F-916): the Owner closes a month by hand and sees a preview first. Same pair as the Rewards settings write, plus the Owner check.
router.post('/:period/preview', requireResourcePermission('settings', 'update'), requireSuperAdmin, periodCloseController.preview);
router.post('/:period', requireResourcePermission('settings', 'update'), requireSuperAdmin, periodCloseController.run);

export default router;
