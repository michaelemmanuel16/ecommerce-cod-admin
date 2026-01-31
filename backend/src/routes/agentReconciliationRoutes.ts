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
    requireRole('super_admin', 'admin', 'manager', 'accountant'),
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
    requireRole('super_admin', 'admin', 'manager', 'accountant'),
    [
        param('agentId').isInt().toInt(),
        validate
    ],
    agentReconciliationController.getAgentStats
);

// Verification (Accountant only)
router.post('/:id/verify',
    requireRole('super_admin', 'admin', 'manager', 'accountant'),
    [
        param('id').isInt().toInt(),
        validate
    ],
    agentReconciliationController.verifyCollection
);

router.post('/bulk-verify',
    requireRole('super_admin', 'admin', 'manager', 'accountant'),
    [
        body('ids').isArray({ min: 1 }),
        body('ids.*').isInt().toInt(),
        validate
    ],
    agentReconciliationController.bulkVerify
);

// Approval (Manager/Admin only)
router.post('/:id/approve',
    requireRole('super_admin', 'admin', 'manager'),
    [
        param('id').isInt().toInt(),
        validate
    ],
    agentReconciliationController.approveCollection
);

// Balance tracking (Agent, Manager, Admin)
router.get('/agents/:id/balance',
    requireRole('super_admin', 'admin', 'manager', 'accountant', 'delivery_agent'),
    [
        param('id').isInt().toInt(),
        validate
    ],
    agentReconciliationController.getAgentBalance
);
router.get('/agents/balances', requireRole('super_admin', 'admin', 'manager', 'accountant'), agentReconciliationController.getBalances);

// Deposits
router.get('/deposits',
    requireRole('super_admin', 'admin', 'manager', 'accountant'),
    [
        query('agentId').optional().isInt().toInt(),
        query('status').optional().isString(),
        query('startDate').optional().isISO8601().toDate(),
        query('endDate').optional().isISO8601().toDate(),
        validate
    ],
    agentReconciliationController.getDeposits
);
router.post('/deposits',
    requireRole('super_admin', 'admin', 'manager', 'accountant', 'delivery_agent'),
    [
        body('amount').isFloat({ min: 0.1, max: 999999999.99 })
            .withMessage('Amount must be a positive number between 0.1 and 999,999,999.99').toFloat(),
        body('depositMethod').isIn(['bank_transfer', 'cash', 'mobile_money', 'check'])
            .withMessage('Invalid deposit method'),
        body('referenceNumber').trim().notEmpty().withMessage('Reference number is required')
            .isLength({ min: 1, max: 100 }).withMessage('Reference number is too long'),
        body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes are too long'),
        body('agentId').optional().isInt().toInt(),
        validate
    ],
    agentReconciliationController.createDeposit
);

router.post('/deposits/:id/verify',
    requireRole('super_admin', 'accountant'),
    [
        param('id').isInt().toInt(),
        validate
    ],
    agentReconciliationController.verifyDeposit
);

router.post('/deposits/:id/reject',
    requireRole('super_admin', 'accountant'),
    [
        param('id').isInt().toInt(),
        body('notes').notEmpty().withMessage('Rejection notes are required').isLength({ min: 5 }),
        validate
    ],
    agentReconciliationController.rejectDeposit
);

// Aging Report
router.get('/aging',
    requireRole('super_admin', 'admin', 'manager', 'accountant'),
    agentReconciliationController.getAgingReport
);

router.get('/aging/export',
    requireRole('super_admin', 'admin', 'manager', 'accountant'),
    agentReconciliationController.exportAgingReport
);

// Agent Blocking
router.post('/agents/:id/block',
    requireRole('super_admin', 'admin', 'manager'),
    [
        param('id').isInt().toInt(),
        body('reason').notEmpty().withMessage('Reason is required'),
        validate
    ],
    agentReconciliationController.blockAgent
);

router.post('/agents/:id/unblock',
    requireRole('super_admin', 'admin', 'manager'),
    [
        param('id').isInt().toInt(),
        validate
    ],
    agentReconciliationController.unblockAgent
);

router.get('/agents/blocked',
    requireRole('super_admin', 'admin', 'manager', 'accountant'),
    agentReconciliationController.getBlockedAgents
);

export default router;
