import { Router } from 'express';
import * as deliveryController from '../controllers/deliveryController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

router.get('/', paginationValidation, validate, deliveryController.getAllDeliveries);
router.get('/agent-orders', requireResourcePermission('orders', 'view'), deliveryController.getAgentOrders);
router.get('/by-order/:orderId', requireResourcePermission('orders', 'view'), deliveryController.getDeliveryByOrderId);
router.get('/routes/:agentId', deliveryController.getAgentRoute);
router.get('/:id', deliveryController.getDelivery);
router.patch('/:id/proof', deliveryController.uploadProofOfDelivery);
router.patch('/:id/complete', deliveryController.completeDelivery);

export default router;
