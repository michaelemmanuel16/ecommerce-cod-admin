import { Router } from 'express';
import * as notificationController from '../controllers/notificationController';
import { authenticate } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

router.get('/', paginationValidation, validate, notificationController.getNotifications);
router.patch('/:id/read', notificationController.markAsRead);
router.patch('/read-all', notificationController.markAllAsRead);

export default router;
