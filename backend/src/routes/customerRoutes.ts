import { Router } from 'express';
import * as customerController from '../controllers/customerController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate } from '../middleware/validation';
import { createCustomerValidation, customerListValidation, updateCustomerValidation } from '../utils/validators';
import { bulkOrderRateLimiter } from '../middleware/bulkRateLimiter';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

router.get('/', customerListValidation, validate, requireResourcePermission('customers', 'view'), customerController.getAllCustomers);
// Before /:id so `export` and `summary` are not read as a customer id
router.get('/summary', customerListValidation, validate, requireResourcePermission('customers', 'view'), customerController.getCustomerSummary);
router.get('/export', bulkOrderRateLimiter, requireResourcePermission('customers', 'export'), customerController.exportCustomers);
router.post('/', createCustomerValidation, validate, requireResourcePermission('customers', 'create'), customerController.createCustomer);
router.get('/:id', requireResourcePermission('customers', 'view'), customerController.getCustomer);
router.put('/:id', updateCustomerValidation, validate, requireResourcePermission('customers', 'update'), customerController.updateCustomer);
router.delete('/:id', requireResourcePermission('customers', 'delete'), customerController.deleteCustomer);

export default router;
