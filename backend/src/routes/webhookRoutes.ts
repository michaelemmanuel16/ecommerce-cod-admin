import { Router } from 'express';
import * as webhookController from '../controllers/webhookController';
import { authenticate, requirePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';
import { webhookLimiter, apiLimiter } from '../middleware/rateLimiter';

const router = Router();

// Public webhook endpoints (no auth required, uses signature verification)
router.post('/import/:uniqueUrl', webhookLimiter, webhookController.importOrdersViaUniqueUrl); // Unique URL-based import
router.post('/import', webhookLimiter, webhookController.importOrdersViaWebhook); // Legacy API key-based import

// Protected routes
router.use(authenticate);
router.use(apiLimiter); // Rate limiting for authenticated webhook management

router.get('/', requirePermission(['super_admin', 'admin']), webhookController.getAllWebhooks);
router.post('/', requirePermission(['super_admin', 'admin']), webhookController.createWebhook);
router.get('/:id', requirePermission(['super_admin', 'admin']), webhookController.getWebhook);
router.put('/:id', requirePermission(['super_admin', 'admin']), webhookController.updateWebhook);
router.delete('/:id', requirePermission(['super_admin', 'admin']), webhookController.deleteWebhook);
router.get('/:id/logs', requirePermission(['super_admin', 'admin']), paginationValidation, validate, webhookController.getWebhookLogs);
router.post('/:id/test', requirePermission(['super_admin', 'admin']), webhookController.testWebhook);

export default router;
