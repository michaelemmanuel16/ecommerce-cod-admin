import { Router } from 'express';
import * as controller from '../controllers/conversationController';
import { authenticate, requireRole } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// Owner, admin and manager see all conversations; a rep sees their own (checked in the service)
router.use(requireRole('super_admin', 'admin', 'manager', 'sales_rep'));
router.get('/', controller.list);
router.get('/whatsapp-status', controller.whatsappStatus);
router.get('/for-order/:orderId', controller.forOrder);
router.post('/start', controller.start);
router.get('/:id', controller.one);
router.get('/:id/messages', controller.messages);
router.post('/:id/reply', controller.reply);
router.patch('/:id', controller.patch);

export default router;
