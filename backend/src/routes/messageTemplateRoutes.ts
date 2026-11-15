import { Router } from 'express';
import * as controller from '../controllers/messageTemplateController';
import { authenticate, requireRole } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// Anyone who answers conversations can pick a template; only owner and admin change them
router.get('/', requireRole('super_admin', 'admin', 'manager', 'sales_rep'), controller.list);
router.post('/sync', requireRole('super_admin', 'admin'), controller.sync);
router.post('/', requireRole('super_admin', 'admin'), controller.create);
router.put('/:id', requireRole('super_admin', 'admin'), controller.update);
router.delete('/:id', requireRole('super_admin', 'admin'), controller.remove);

export default router;
