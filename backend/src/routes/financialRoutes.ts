import { Router } from 'express';
import * as financialController from '../controllers/financialController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

router.get('/summary', requireResourcePermission('financial', 'view'), financialController.getFinancialSummary);
router.get('/transactions', requireResourcePermission('financial', 'view'), paginationValidation, validate, financialController.getAllTransactions);
router.post('/expenses', requireResourcePermission('financial', 'create'), financialController.recordExpense);
router.get('/cod-collections', requireResourcePermission('financial', 'view'), paginationValidation, validate, financialController.getCODCollections);
router.get('/reports', requireResourcePermission('financial', 'view'), financialController.getFinancialReports);

export default router;
