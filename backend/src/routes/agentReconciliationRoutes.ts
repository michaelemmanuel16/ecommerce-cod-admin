import { Router } from 'express';
import agentReconciliationController from '../controllers/agentReconciliationController';
import { authenticate, requireRole } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Listing and stats (Available to Accountant, Manager, Admin)
router.get('/', requireRole('accountant', 'manager', 'admin'), agentReconciliationController.getCollections);
router.get('/stats/:agentId', requireRole('accountant', 'manager', 'admin'), agentReconciliationController.getAgentStats);

// Verification (Accountant only)
router.post('/:id/verify', requireRole('accountant'), agentReconciliationController.verifyCollection);
router.post('/bulk-verify', requireRole('accountant'), agentReconciliationController.bulkVerify);

// Approval (Manager/Admin only)
router.post('/:id/approve', requireRole('manager', 'admin'), agentReconciliationController.approveCollection);

// Balance tracking (Agent, Manager, Admin)
router.get('/agents/:id/balance', requireRole('delivery_agent', 'manager', 'admin', 'accountant'), agentReconciliationController.getAgentBalance);
router.get('/agents/balances', requireRole('manager', 'admin', 'accountant'), agentReconciliationController.getBalances);

// Deposits
router.post('/deposits', requireRole('delivery_agent', 'manager', 'admin', 'accountant'), agentReconciliationController.createDeposit);
router.post('/deposits/:id/verify', requireRole('accountant'), agentReconciliationController.verifyDeposit);

export default router;
