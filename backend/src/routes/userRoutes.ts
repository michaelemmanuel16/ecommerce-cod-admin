import { Router } from 'express';
import * as userController from '../controllers/userController';
import * as payoutController from '../controllers/payoutController';
import { authenticate, requirePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

router.get('/', requirePermission(['super_admin', 'admin', 'manager']), paginationValidation, validate, userController.getAllUsers);
router.post('/', requirePermission(['super_admin', 'admin']), userController.createUser);
router.get('/reps/workload', requirePermission(['super_admin', 'admin', 'manager']), userController.getRepWorkload);
router.get('/reps/performance', requirePermission(['super_admin', 'admin', 'manager', 'sales_rep']), userController.getRepPerformance);
router.put('/reps/:id', requirePermission(['super_admin', 'admin', 'manager']), userController.updateRepDetails);
router.get('/reps/:id/pending-payments', requirePermission(['super_admin', 'admin', 'manager']), payoutController.getPendingPayments);
router.get('/reps/:id/payout-history', requirePermission(['super_admin', 'admin', 'manager']), payoutController.getPayoutHistory);
router.post('/reps/:id/process-payout', requirePermission(['super_admin', 'admin', 'manager']), payoutController.processPayout);
router.get('/agents/performance', requirePermission(['super_admin', 'admin', 'manager']), userController.getAgentPerformance);
router.get('/preferences', userController.getUserPreferences);
router.put('/preferences', userController.updateUserPreferences);
router.get('/:id', userController.getUser);
router.put('/:id', requirePermission(['super_admin', 'admin']), userController.updateUser);
router.delete('/:id', requirePermission(['super_admin', 'admin']), userController.deleteUser);
router.patch('/:id/availability', userController.toggleAvailability);

export default router;
