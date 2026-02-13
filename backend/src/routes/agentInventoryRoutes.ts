import { Router } from 'express';
import agentInventoryController from '../controllers/agentInventoryController';
import { authenticate, requireRole } from '../middleware/auth';
import { body, param, query } from 'express-validator';
import { validate } from '../middleware/validation';

const router = Router();

// All routes require authentication
router.use(authenticate);

// --- Mutations (admin, manager, inventory_manager, super_admin) ---

router.post(
  '/allocate',
  requireRole('super_admin', 'admin', 'manager', 'inventory_manager'),
  [
    body('productId').isInt({ min: 1 }).withMessage('Valid productId is required').toInt(),
    body('agentId').isInt({ min: 1 }).withMessage('Valid agentId is required').toInt(),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1').toInt(),
    body('notes').optional().trim().isLength({ max: 500 }),
    validate,
  ],
  agentInventoryController.allocateStock
);

router.post(
  '/transfer',
  requireRole('super_admin', 'admin', 'manager', 'inventory_manager'),
  [
    body('productId').isInt({ min: 1 }).withMessage('Valid productId is required').toInt(),
    body('fromAgentId').isInt({ min: 1 }).withMessage('Valid fromAgentId is required').toInt(),
    body('toAgentId').isInt({ min: 1 }).withMessage('Valid toAgentId is required').toInt(),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1').toInt(),
    body('notes').optional().trim().isLength({ max: 500 }),
    validate,
  ],
  agentInventoryController.transferStock
);

router.post(
  '/return',
  requireRole('super_admin', 'admin', 'manager', 'inventory_manager'),
  [
    body('productId').isInt({ min: 1 }).withMessage('Valid productId is required').toInt(),
    body('agentId').isInt({ min: 1 }).withMessage('Valid agentId is required').toInt(),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1').toInt(),
    body('notes').optional().trim().isLength({ max: 500 }),
    validate,
  ],
  agentInventoryController.returnStock
);

router.post(
  '/adjust',
  requireRole('super_admin', 'admin', 'manager', 'inventory_manager'),
  [
    body('productId').isInt({ min: 1 }).withMessage('Valid productId is required').toInt(),
    body('agentId').isInt({ min: 1 }).withMessage('Valid agentId is required').toInt(),
    body('newQuantity').isInt({ min: 0 }).withMessage('New quantity must be 0 or more').toInt(),
    body('notes').trim().notEmpty().withMessage('Notes are required for adjustments').isLength({ max: 500 }),
    validate,
  ],
  agentInventoryController.adjustStock
);

// --- Read endpoints (broader access) ---

router.get(
  '/product/:productId',
  requireRole('super_admin', 'admin', 'manager', 'inventory_manager', 'accountant'),
  [param('productId').isInt({ min: 1 }).toInt(), validate],
  agentInventoryController.getProductAgentStock
);

router.get(
  '/agent/:agentId',
  requireRole('super_admin', 'admin', 'manager', 'inventory_manager', 'accountant', 'delivery_agent'),
  [param('agentId').isInt({ min: 1 }).toInt(), validate],
  agentInventoryController.getAgentInventory
);

router.get(
  '/transfers',
  requireRole('super_admin', 'admin', 'manager', 'inventory_manager', 'accountant'),
  [
    query('productId').optional().isInt().toInt(),
    query('agentId').optional().isInt().toInt(),
    query('type').optional().isString(),
    query('startDate').optional().isISO8601().toDate(),
    query('endDate').optional().isISO8601().toDate(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    validate,
  ],
  agentInventoryController.getTransferHistory
);

router.get(
  '/summary',
  requireRole('super_admin', 'admin', 'manager', 'inventory_manager', 'accountant'),
  agentInventoryController.getSummary
);

export default router;
