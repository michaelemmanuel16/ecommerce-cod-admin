import { Router } from 'express';
import * as callController from '../controllers/callController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { createCallValidation, paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

// Create new call log (sales reps, managers, admins)
router.post('/', createCallValidation, validate, requireResourcePermission('calls', 'create'), callController.createCall);

// Get calls with filters (sales reps see own, managers/admins see all)
router.get('/', paginationValidation, validate, requireResourcePermission('calls', 'view'), callController.getCalls);

// Get calls for specific order
router.get('/order/:orderId', requireResourcePermission('calls', 'view'), callController.getCallsByOrder);

// Get calls for specific customer
router.get('/customer/:customerId', requireResourcePermission('calls', 'view'), callController.getCallsByCustomer);

// Get call statistics (for manager dashboard)
router.get('/stats', requireResourcePermission('calls', 'view'), callController.getCallStats);

export default router;
