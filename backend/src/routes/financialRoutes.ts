import { Router } from 'express';
import * as financialController from '../controllers/financialController';
import { getFinancialHealth } from '../controllers/ledgerHealthController';
import * as financeExport from '../controllers/financeExportController';
import { authenticate, requirePermission, requireResourcePermission, requireRole } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';
import { apiLimiter } from '../middleware/rateLimiter';

const router = Router();

router.use(apiLimiter);
router.use(authenticate);
router.use(tenantRateLimiter);

// Financial summary and reports
router.get('/summary', requireResourcePermission('financial', 'view'), financialController.getFinancialSummary);
router.get('/reports', requireResourcePermission('financial', 'view'), financialController.getFinancialReports);
router.get('/balance-sheet', requireResourcePermission('financial', 'view'), financialController.getBalanceSheet);
router.get('/profit-loss', requireResourcePermission('financial', 'view'), financialController.getProfitLoss);
router.get('/profit-loss/export', requireResourcePermission('financial', 'view'), financeExport.exportFinanceReport);

// The four Finance exports (CSV or Excel) and the background jobs behind them (M5-T29)
router.get('/export/:report', requireResourcePermission('financial', 'view'), financeExport.exportFinanceReport);
router.get('/jobs/:id', requireResourcePermission('financial', 'view'), financeExport.getFinanceJobStatus);
router.get('/jobs/:id/download', requireResourcePermission('financial', 'view'), financeExport.downloadFinanceJob);
router.get('/profitability', requireResourcePermission('financial', 'view'), financialController.getProfitabilityAnalysis);
router.get('/profitability/export', requireResourcePermission('financial', 'view'), financialController.exportProfitabilityAnalysis);
router.get('/pipeline-revenue', requireResourcePermission('financial', 'view'), financialController.getPipelineRevenue);
router.get('/cash-flow', requireResourcePermission('financial', 'view'), financialController.getCashFlowReport);
router.get('/cash-flow/export/csv', requireResourcePermission('financial', 'view'), financialController.exportCashFlowCSV);
router.get('/unpaid-by-age', requireResourcePermission('financial', 'view'), financialController.getUnpaidByAge);
router.get('/agent-aging', requireResourcePermission('financial', 'view'), financialController.getAgentAgingReport);
router.get('/agent-aging/export/csv', requireResourcePermission('financial', 'view'), financialController.exportAgentAgingCSV);

// Transactions and collections
router.get('/transactions', requireResourcePermission('financial', 'view'), paginationValidation, validate, financialController.getAllTransactions);
router.get('/cod-collections', requireResourcePermission('financial', 'view'), paginationValidation, validate, financialController.getCODCollections);
router.post('/collections/deposit', requireResourcePermission('financial', 'update'), financialController.markCollectionsAsDeposited);
router.post('/transactions/:id/reconcile', requireResourcePermission('financial', 'update'), financialController.reconcileTransaction);

// Expenses
router.get('/expenses', requireResourcePermission('financial', 'view'), paginationValidation, validate, financialController.getAllExpenses);
router.post('/expenses', requireResourcePermission('financial', 'create'), financialController.recordExpense);
router.get('/expenses/breakdown', requireResourcePermission('financial', 'view'), financialController.getExpenseBreakdown);
router.get('/expense-categories', requireResourcePermission('financial', 'view', 'create'), financialController.getExpenseCategories);
// Edit and delete: owner, admin and finance clerk (F-917). The ledger entry is reversed or replaced by the service.
router.put('/expenses/:id', requireResourcePermission('expenses', 'edit'), financialController.updateExpense);
router.delete('/expenses/:id', requireResourcePermission('expenses', 'delete'), financialController.deleteExpense);

// Paystack payout to the bank: DR 1010, CR 1030 (F-934)
router.post('/paystack-payouts', requirePermission(['super_admin', 'admin']), financialController.postPaystackPayout);

// Agent reconciliation
router.get('/agent-cash-holdings', requireResourcePermission('financial', 'view'), financialController.getAgentCashHoldings);
router.get('/agents/settlement/:agentId', requireResourcePermission('financial', 'view'), financialController.getAgentSettlement);

// Financial health: GL balance integrity plus the order-versus-ledger check (M1-T28)
router.get('/health', requireResourcePermission('financial', 'view'), getFinancialHealth);

// Admin maintenance endpoints
router.post('/refresh-aging', requireRole('admin', 'super_admin'), financialController.refreshAgingBuckets);
router.post('/backfill-collections', requireRole('admin', 'super_admin'), financialController.backfillMissingCollections);
router.post('/backfill-delivery-dates', requireRole('admin', 'super_admin'), financialController.backfillDeliveryDates);
router.post('/backfill-commissions', requireRole('admin', 'super_admin'), financialController.backfillCommissions);

export default router;
