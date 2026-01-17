import { Router } from 'express';
import * as glController from '../controllers/glController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { paginationValidation, createAccountValidation, updateAccountValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

// Chart of Accounts
router.get('/accounts', requireResourcePermission('gl', 'view'), paginationValidation, validate, glController.getAllAccounts);
router.post('/accounts', requireResourcePermission('gl', 'create'), createAccountValidation, validate, glController.createAccount);
router.get('/accounts/:id', requireResourcePermission('gl', 'view'), glController.getAccount);
router.put('/accounts/:id', requireResourcePermission('gl', 'update'), updateAccountValidation, validate, glController.updateAccount);
router.delete('/accounts/:id', requireResourcePermission('gl', 'delete'), glController.deleteAccount);
router.patch('/accounts/:id/deactivate', requireResourcePermission('gl', 'update'), glController.deactivateAccount);
router.patch('/accounts/:id/activate', requireResourcePermission('gl', 'update'), glController.activateAccount);

export default router;
