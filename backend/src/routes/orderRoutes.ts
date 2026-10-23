import { Router } from 'express';
import * as orderController from '../controllers/orderController';
import * as bulkOrderController from '../controllers/bulkOrderController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate, validateRequest } from '../middleware/validation';
import { spreadsheetUpload, handleImportUploadErrors } from '../config/multer';
import { createOrderValidation, updateOrderStatusValidation, assignRepValidation, assignAgentValidation, orderListValidation, bulkDeleteValidation, bulkStatusValidation, bulkAssignValidation } from '../utils/validators';
import { bulkOrderRateLimiter, bulkImportRateLimiter } from '../middleware/bulkRateLimiter';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// A GET on a path such as /kanban (removed, F-327) is not an order id: 404, not a database error
router.param('id', (req, res, next, id) => {
  if (req.method !== 'GET' || /^\d+$/.test(id)) next();
  else res.status(404).json({ message: 'Order not found' });
});

router.get('/', orderListValidation, validate, requireResourcePermission('orders', 'view'), orderController.getAllOrders);
router.get('/counts', orderListValidation, validate, requireResourcePermission('orders', 'view'), orderController.getOrderCounts);
router.get('/export', bulkOrderRateLimiter, requireResourcePermission('orders', 'view'), orderController.exportOrders);
router.post('/upload/validate', requireResourcePermission('orders', 'bulk_import'), bulkImportRateLimiter, spreadsheetUpload.single('file'), handleImportUploadErrors, bulkOrderController.validateUpload);
router.post('/upload', requireResourcePermission('orders', 'bulk_import'), bulkImportRateLimiter, spreadsheetUpload.single('file'), handleImportUploadErrors, bulkOrderController.uploadOrders);
router.post('/bulk', requireResourcePermission('orders', 'bulk_import'), orderController.bulkImportOrders);
router.get('/statuses', requireResourcePermission('orders', 'view'), orderController.getOrderStatuses);
router.get('/stats', requireResourcePermission('orders', 'view'), orderController.getOrderStats);
router.delete('/bulk', bulkOrderRateLimiter, bulkDeleteValidation, validate, requireResourcePermission('orders', 'delete'), orderController.bulkDeleteOrders);
// Before /:id/... so `bulk` is not read as an order id
router.patch('/bulk/status', validateRequest(bulkStatusValidation), requireResourcePermission('orders', 'update', 'update_status'), orderController.bulkUpdateOrderStatus);
router.patch('/bulk/assign', validateRequest(bulkAssignValidation), requireResourcePermission('orders', 'assign'), orderController.bulkAssignOrders);

router.post('/', createOrderValidation, validate, requireResourcePermission('orders', 'create'), orderController.createOrder);
router.get('/:id', requireResourcePermission('orders', 'view'), orderController.getOrder);
router.put('/:id', requireResourcePermission('orders', 'update'), orderController.updateOrder);
router.delete('/:id', requireResourcePermission('orders', 'delete'), orderController.deleteOrder);
router.get('/:id/timeline', requireResourcePermission('orders', 'view'), orderController.getOrderTimeline);
router.get('/:id/transitions', requireResourcePermission('orders', 'view'), orderController.getOrderTransitions);
router.patch('/:id/status', validateRequest(updateOrderStatusValidation), requireResourcePermission('orders', 'update', 'update_status'), orderController.updateOrderStatus);
router.patch('/:id/assign-rep', validateRequest(assignRepValidation), requireResourcePermission('orders', 'assign'), orderController.assignCustomerRep);
router.patch('/:id/assign-agent', validateRequest(assignAgentValidation), requireResourcePermission('orders', 'assign'), orderController.assignDeliveryAgent);

export default router;
