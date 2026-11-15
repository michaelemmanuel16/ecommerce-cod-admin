import { Router } from 'express';
import * as notificationController from '../controllers/notificationController';
import { authenticate, requireRole } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

router.get('/', paginationValidation, validate, notificationController.getNotifications);
router.get('/unread-count', notificationController.getUnreadCount);
router.get('/preferences', notificationController.getPreferences);
router.put('/preferences', notificationController.putPreferences);
router.get('/role-defaults', requireRole('manager', 'admin', 'super_admin'), notificationController.getRoleDefaults);
router.put('/role-defaults', requireRole('manager', 'admin', 'super_admin'), notificationController.putRoleDefaults);
router.patch('/:id/read', notificationController.markAsRead);
router.patch('/read-all', notificationController.markAllAsRead);

export default router;
