import { Router } from 'express';
import * as financialController from '../controllers/financialController';
import { authenticate, requirePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

router.get('/summary', requirePermission(['super_admin', 'admin', 'manager', 'accountant']), financialController.getFinancialSummary);
router.get('/transactions', requirePermission(['super_admin', 'admin', 'accountant']), paginationValidation, validate, financialController.getAllTransactions);
router.post('/expenses', requirePermission(['super_admin', 'admin', 'accountant']), financialController.recordExpense);
router.get('/cod-collections', requirePermission(['super_admin', 'admin', 'accountant']), paginationValidation, validate, financialController.getCODCollections);
router.get('/reports', requirePermission(['super_admin', 'admin', 'manager', 'accountant']), financialController.getFinancialReports);

export default router;
