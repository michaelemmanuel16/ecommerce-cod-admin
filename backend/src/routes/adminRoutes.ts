import { Router } from 'express';
import * as adminController from '../controllers/adminController';
import { authenticate, requireSuperAdmin, requirePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
const router = Router();

// Public Configuration (No auth required). Needs ?tenant=<slug> or ?form=<form slug>;
// returns only that tenant's business name and currency. 404 without a known slug.
router.get('/config', adminController.getPublicConfigBySlug);

router.use(authenticate);
router.use(tenantRateLimiter);

// Authenticated tenant config — same public-safe shape as /config, but the JWT
// gives us tenant context so the caller gets THEIR tenant's currency/business
// name. Available to every authenticated role, not just super_admin.
router.get('/config/me', adminController.getPublicConfig);

// System Configuration
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
