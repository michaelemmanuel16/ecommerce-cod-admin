import { Router } from 'express';
import * as adminController from '../controllers/adminController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

const router = Router();
router.use(authenticate);
router.use(tenantRateLimiter);

router.get('/operations', requireResourcePermission('settings', 'view'), adminController.getOperationsSettings);
router.put('/operations', requireResourcePermission('settings', 'update'), adminController.updateOperationsSettings);

export default router;
