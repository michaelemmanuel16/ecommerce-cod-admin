import { Router } from 'express';
import * as customerController from '../controllers/customerController';
import { authenticate, requirePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { createCustomerValidation, paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

router.get('/', paginationValidation, validate, customerController.getAllCustomers);
router.post('/', createCustomerValidation, validate, customerController.createCustomer);
router.get('/:id', customerController.getCustomer);
router.put('/:id', customerController.updateCustomer);
router.delete('/:id', requirePermission(['super_admin', 'admin', 'manager']), customerController.deleteCustomer);
router.patch('/:id/tags', customerController.updateCustomerTags);
router.get('/:id/analytics', customerController.getCustomerAnalytics);

export default router;
