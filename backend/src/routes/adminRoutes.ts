import { Router } from 'express';
import * as adminController from '../controllers/adminController';
import { authenticate, requireSuperAdmin, requirePermission } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// System Configuration (super_admin only)
router.get('/settings', requireSuperAdmin, adminController.getSystemConfig);
router.put('/settings', requireSuperAdmin, adminController.updateSystemConfig);

// Role Permissions (super_admin only)
router.get('/permissions', requireSuperAdmin, adminController.getRolePermissions);
router.put('/permissions', requireSuperAdmin, adminController.updateRolePermissions);

// User Management (super_admin and admin)
router.get('/users', requirePermission(['super_admin', 'admin', "manager"]), adminController.getAllUsers);
router.post('/users', requirePermission(['super_admin', 'admin']), adminController.createUser);
router.put('/users/:id', requirePermission(['super_admin', 'admin']), adminController.updateUser);
router.post('/users/:id/reset-password', requirePermission(['super_admin', 'admin']), adminController.resetUserPassword);
router.delete('/users/:id', requirePermission(['super_admin', 'admin']), adminController.deleteUser);
router.delete('/users/:id/permanent', requirePermission(['super_admin', 'admin']), adminController.permanentlyDeleteUser);

export default router;
