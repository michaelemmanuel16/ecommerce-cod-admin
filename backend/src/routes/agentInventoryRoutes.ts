import { Router } from 'express';
import agentInventoryController from '../controllers/agentInventoryController';
import { authenticate, requireRole } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { param, query } from 'express-validator';
import { validate } from '../middleware/validation';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(tenantRateLimiter);

// Read endpoints only. The write routes moved to /api/inventory (M4-T10); these GETs stay as aliases for one release.

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
  requireRole('super_admin', 'admin', 'manager', 'inventory_manager', 'accountant', 'delivery_agent'),
  [
    query('productId').optional().isInt().toInt(),
    query('agentId').optional().isInt().toInt(),
    query('type').optional().isIn(['allocation', 'order_fulfillment', 'agent_transfer', 'return_to_warehouse', 'adjustment'])
      .withMessage('Invalid transfer type'),
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
