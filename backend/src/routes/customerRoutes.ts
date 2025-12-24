import { Router } from 'express';
import * as customerController from '../controllers/customerController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { createCustomerValidation, paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

router.get('/', paginationValidation, validate, requireResourcePermission('customers', 'view'), customerController.getAllCustomers);
router.post('/', createCustomerValidation, validate, requireResourcePermission('customers', 'create'), customerController.createCustomer);
router.get('/:id', requireResourcePermission('customers', 'view'), customerController.getCustomer);
router.put('/:id', requireResourcePermission('customers', 'update'), customerController.updateCustomer);
router.delete('/:id', requireResourcePermission('customers', 'delete'), customerController.deleteCustomer);
router.patch('/:id/tags', requireResourcePermission('customers', 'update'), customerController.updateCustomerTags);
router.get('/:id/analytics', requireResourcePermission('customers', 'view'), customerController.getCustomerAnalytics);

export default router;
