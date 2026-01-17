import { Router } from 'express';
import * as orderController from '../controllers/orderController';
import * as bulkOrderController from '../controllers/bulkOrderController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { validate, validateRequest } from '../middleware/validation';
import { spreadsheetUpload, handleUploadErrors } from '../config/multer';
import { createOrderValidation, updateOrderStatusValidation, paginationValidation, bulkDeleteValidation } from '../utils/validators';
import { bulkOrderRateLimiter, bulkImportRateLimiter } from '../middleware/bulkRateLimiter';

const router = Router();

router.use(authenticate);

router.get('/', paginationValidation, validate, requireResourcePermission('orders', 'view'), orderController.getAllOrders);
router.get('/export', bulkOrderRateLimiter, requireResourcePermission('orders', 'view'), bulkOrderController.exportOrders);
router.post('/upload', bulkImportRateLimiter, spreadsheetUpload.single('file'), handleUploadErrors, requireResourcePermission('orders', 'bulk_import'), bulkOrderController.uploadOrders);
router.post('/bulk', requireResourcePermission('orders', 'bulk_import'), orderController.bulkImportOrders);
router.get('/kanban', requireResourcePermission('orders', 'view'), orderController.getKanbanView);
router.get('/stats', requireResourcePermission('orders', 'view'), orderController.getOrderStats);
router.delete('/bulk', bulkOrderRateLimiter, bulkDeleteValidation, validate, requireResourcePermission('orders', 'delete'), orderController.bulkDeleteOrders);

router.post('/', createOrderValidation, validate, requireResourcePermission('orders', 'create'), orderController.createOrder);
router.get('/:id', requireResourcePermission('orders', 'view'), orderController.getOrder);
router.put('/:id', requireResourcePermission('orders', 'update'), orderController.updateOrder);
router.delete('/:id', requireResourcePermission('orders', 'delete'), orderController.deleteOrder);
router.patch('/:id/status', validateRequest(updateOrderStatusValidation), requireResourcePermission('orders', 'update'), orderController.updateOrderStatus);
router.patch('/:id/assign-rep', requireResourcePermission('orders', 'assign'), orderController.assignCustomerRep);
router.patch('/:id/assign-agent', requireResourcePermission('orders', 'assign'), orderController.assignDeliveryAgent);

export default router;
