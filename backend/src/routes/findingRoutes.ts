import { Router } from 'express';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import * as controller from '../controllers/findingController';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// F-909: view needs financial:view; assign, explain and write off need financial:update (a write-off is also owner-only, in the service)
router.get('/', requireResourcePermission('financial', 'view'), controller.list);
router.patch('/:id(\\d+)', requireResourcePermission('financial', 'update'), controller.update);

export default router;
