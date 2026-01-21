import { Router } from 'express';
import agentReconciliationController from '../controllers/agentReconciliationController';
import { authenticate, requireRole } from '../middleware/auth';
import { body, param, query } from 'express-validator';
import { validate } from '../middleware/validation';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Listing and stats (Available to Accountant, Manager, Admin)
router.get('/',
    requireRole('accountant', 'manager', 'admin'),
    [
        query('agentId').optional().isInt().toInt(),
        query('status').optional().isString(),
        query('startDate').optional().isISO8601().toDate(),
        query('endDate').optional().isISO8601().toDate(),
        validate
    ],
    agentReconciliationController.getCollections
);
router.get('/stats/:agentId',
    requireRole('accountant', 'manager', 'admin'),
    [
        param('agentId').isInt().toInt(),
        validate
    ],
    agentReconciliationController.getAgentStats
);

// Verification (Accountant only)
router.post('/:id/verify',
    requireRole('accountant'),
    [
        param('id').isInt().toInt(),
        validate
    ],
    agentReconciliationController.verifyCollection
);

router.post('/bulk-verify',
    requireRole('accountant'),
    [
        body('ids').isArray({ min: 1 }),
        body('ids.*').isInt().toInt(),
        validate
    ],
    agentReconciliationController.bulkVerify
);

// Approval (Manager/Admin only)
router.post('/:id/approve',
    requireRole('manager', 'admin'),
    [
        param('id').isInt().toInt(),
        validate
    ],
    agentReconciliationController.approveCollection
);

// Balance tracking (Agent, Manager, Admin)
router.get('/agents/:id/balance',
    requireRole('delivery_agent', 'manager', 'admin', 'accountant'),
    [
        param('id').isInt().toInt(),
        validate
    ],
    agentReconciliationController.getAgentBalance
);
router.get('/agents/balances', requireRole('manager', 'admin', 'accountant'), agentReconciliationController.getBalances);

// Deposits
router.post('/deposits',
    requireRole('delivery_agent', 'manager', 'admin', 'accountant'),
    [
        body('amount').isNumeric().toFloat(),
        body('referenceNumber').optional().isString(),
        body('notes').optional().isString(),
        body('agentId').optional().isInt().toInt(),
        validate
    ],
    agentReconciliationController.createDeposit
);

router.post('/deposits/:id/verify',
    requireRole('accountant'),
    [
        param('id').isInt().toInt(),
        validate
    ],
    agentReconciliationController.verifyDeposit
);

router.post('/deposits/:id/reject',
    requireRole('accountant'),
    [
        param('id').isInt().toInt(),
        body('notes').notEmpty().withMessage('Rejection notes are required').isLength({ min: 5 }),
        validate
    ],
    agentReconciliationController.rejectDeposit
);

export default router;
