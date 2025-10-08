import { Router } from 'express';
import * as orderController from '../controllers/orderController';
import { authenticate, requirePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { createOrderValidation, updateOrderStatusValidation, paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

router.get('/', paginationValidation, validate, orderController.getAllOrders);
router.post('/', createOrderValidation, validate, orderController.createOrder);
router.post('/bulk', requirePermission(['super_admin', 'admin', 'manager']), orderController.bulkImportOrders);
router.get('/kanban', orderController.getKanbanView);
router.get('/stats', orderController.getOrderStats);
router.get('/:id', orderController.getOrder);
router.put('/:id', orderController.updateOrder);
router.delete('/:id', requirePermission(['super_admin', 'admin', 'manager']), orderController.deleteOrder);
router.patch('/:id/status', updateOrderStatusValidation, validate, orderController.updateOrderStatus);
router.patch('/:id/assign-rep', requirePermission(['super_admin', 'admin', 'manager']), orderController.assignCustomerRep);
router.patch('/:id/assign-agent', requirePermission(['super_admin', 'admin', 'manager']), orderController.assignDeliveryAgent);

export default router;
