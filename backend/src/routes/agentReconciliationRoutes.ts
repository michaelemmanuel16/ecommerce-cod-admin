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

export default router;
