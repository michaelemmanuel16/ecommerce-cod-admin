import { Router } from 'express';
import { authenticate, requireResourcePermission, requireSuperAdmin } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import * as staffController from '../controllers/staffController';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// M6-T05 (F-1157, F-1159 to F-1162, F-1165). Same `users` cells as the role routes. The service checks that the actor
// outranks the person. Permanent delete is the Owner's alone.
router.get('/', requireResourcePermission('users', 'view'), staffController.list);
router.get('/workload', requireResourcePermission('users', 'view'), staffController.workload);
router.put('/:id', requireResourcePermission('users', 'update'), staffController.update);
router.post('/:id/reset-password', requireResourcePermission('users', 'update'), staffController.resetPassword);
router.post('/:id/deactivate', requireResourcePermission('users', 'update'), staffController.deactivate);
router.post('/:id/reactivate', requireResourcePermission('users', 'update'), staffController.reactivate);
router.delete('/:id/permanent', requireSuperAdmin, staffController.removePermanently);
router.delete('/:id', requireResourcePermission('users', 'delete'), staffController.remove);

export default router;
