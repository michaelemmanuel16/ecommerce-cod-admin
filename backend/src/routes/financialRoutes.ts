import { Router } from 'express';
import * as financialController from '../controllers/financialController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

// Financial summary and reports
router.get('/summary', requireResourcePermission('financial', 'view'), financialController.getFinancialSummary);
router.get('/reports', requireResourcePermission('financial', 'view'), financialController.getFinancialReports);
router.get('/profit-margins', requireResourcePermission('financial', 'view'), financialController.getProfitMargins);
router.get('/pipeline-revenue', requireResourcePermission('financial', 'view'), financialController.getPipelineRevenue);
router.get('/cash-flow', requireResourcePermission('financial', 'view'), financialController.getCashFlowReport);
router.get('/cash-flow/export/csv', requireResourcePermission('financial', 'view'), financialController.exportCashFlowCSV);

// Transactions and collections
router.get('/transactions', requireResourcePermission('financial', 'view'), paginationValidation, validate, financialController.getAllTransactions);
router.get('/cod-collections', requireResourcePermission('financial', 'view'), paginationValidation, validate, financialController.getCODCollections);
router.post('/collections/deposit', requireResourcePermission('financial', 'update'), financialController.markCollectionsAsDeposited);
router.post('/transactions/:id/reconcile', requireResourcePermission('financial', 'update'), financialController.reconcileTransaction);

// Expenses
router.get('/expenses', requireResourcePermission('financial', 'view'), paginationValidation, validate, financialController.getAllExpenses);
router.post('/expenses', requireResourcePermission('financial', 'create'), financialController.recordExpense);
router.get('/expenses/breakdown', requireResourcePermission('financial', 'view'), financialController.getExpenseBreakdown);
router.put('/expenses/:id', requireResourcePermission('financial', 'update'), financialController.updateExpense);
router.delete('/expenses/:id', requireResourcePermission('financial', 'delete'), financialController.deleteExpense);

// Agent reconciliation
router.get('/agent-cash-holdings', requireResourcePermission('financial', 'view'), financialController.getAgentCashHoldings);
router.get('/agents/settlement/:agentId', requireResourcePermission('financial', 'view'), financialController.getAgentSettlement);

export default router;
