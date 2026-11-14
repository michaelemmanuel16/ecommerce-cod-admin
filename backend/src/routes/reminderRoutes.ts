import { Router } from 'express';
import * as controller from '../controllers/reminderController';
import { authenticate } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// M9-T18: any signed-in person may set a reminder; only the creator, the assignee, owner and admin may change one
router.post('/', controller.create);
router.get('/', controller.list);
router.patch('/:id', controller.patch);
router.delete('/:id', controller.remove);

export default router;
