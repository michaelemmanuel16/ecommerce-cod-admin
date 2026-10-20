import { Router } from 'express';
import * as deliveryController from '../controllers/deliveryController';
import { authenticate, requireResourcePermission, requireRole } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// Who may use these routes. Delivery agents are limited to their own deliveries in the
// controller; the accountant reads only; sales reps and the rest are refused.
const canRead = requireRole('super_admin', 'admin', 'manager', 'accountant', 'delivery_agent');
const canWrite = requireRole('super_admin', 'admin', 'delivery_agent');

router.get('/', canRead, paginationValidation, validate, deliveryController.getAllDeliveries);
router.get('/agent-orders', requireResourcePermission('orders', 'view'), deliveryController.getAgentOrders);
router.get('/by-order/:orderId', requireResourcePermission('orders', 'view'), deliveryController.getDeliveryByOrderId);
router.get('/routes/:agentId', canRead, deliveryController.getAgentRoute);
router.get('/:id', canRead, deliveryController.getDelivery);
router.patch('/:id/proof', canWrite, deliveryController.uploadProofOfDelivery);
router.patch('/:id/complete', canWrite, deliveryController.completeDelivery);

export default router;
