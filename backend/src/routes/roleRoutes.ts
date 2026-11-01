import { Router } from 'express';
import { authenticate, requireResourcePermission, requireSuperAdmin } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import * as roleController from '../controllers/roleController';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// M6-T03 (F-1150..F-1156). Read and assign use the `users` cells (Owner and Admin have them). Editing the Owner role is Owner
// only (checked in the service). Making and deleting roles is the Owner's decision (F-1156, F-1150).
// The plain list stays Owner only: the MCP key screen reads it and an M2 test pins that.
router.get('/', requireSuperAdmin, roleController.list);
router.get('/overview', requireResourcePermission('users', 'view'), roleController.overview);
router.post('/', requireSuperAdmin, roleController.create);
router.get('/:id', requireResourcePermission('users', 'view'), roleController.get);
router.put('/:id', requireResourcePermission('users', 'update'), roleController.update);
router.delete('/:id', requireSuperAdmin, roleController.remove);
// M6-T04 (F-1153, F-1154): tool switches and the permission matrix are the Owner's.
router.put('/:id/tools', requireSuperAdmin, roleController.setTools);
router.get('/:id/permissions', requireResourcePermission('users', 'view'), roleController.getPermissions);
router.put('/:id/permissions', requireSuperAdmin, roleController.setPermissions);
router.get('/:id/assignments', requireResourcePermission('users', 'view'), roleController.assignments);
router.post('/:id/assign', requireResourcePermission('users', 'create'), roleController.assign);
router.delete('/:id/assignments/:assignmentId', requireResourcePermission('users', 'update'), roleController.unassign);

export default router;
