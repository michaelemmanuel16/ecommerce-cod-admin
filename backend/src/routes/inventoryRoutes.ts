import { NextFunction, Response, Router } from 'express';
import { body, param } from 'express-validator';
import * as controller from '../controllers/inventoryController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate } from '../middleware/validation';
import { AuthRequest } from '../types';
import { ADJUST_REASONS, CREATE_TYPES, DISPUTE_REASONS, RETURN_REASONS } from '../services/transferService';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// F-654, F-655: the owner, an admin and a stock keeper write stock (products:update_stock).
const canWriteStock = requireResourcePermission('products', 'update_stock');
// A delivery agent confirms stock addressed to them; the service checks it is theirs.
const canReceive = (req: AuthRequest, res: Response, next: NextFunction) =>
  req.user?.role === 'delivery_agent' ? next() : canWriteStock(req, res, next);

const id = param('id').isInt({ min: 1 }).withMessage('Invalid transfer ID').toInt();
const intField = (name: string, min = 1) => body(name).isInt({ min }).withMessage(`${name} must be a whole number${min > 0 ? ' above 0' : ', 0 or more'}`).toInt();
const note = body('note').optional({ nullable: true }).isString().trim().isLength({ max: 500 });

router.post(
  '/transfers',
  canWriteStock,
  [
    body('type').isIn([...CREATE_TYPES]).withMessage('type must be allocation, agent_transfer or return_to_warehouse'),
    intField('productId'), intField('quantity'), intField('fromLocationId'), intField('toLocationId'),
    body('reason').optional({ nullable: true }).isIn([...RETURN_REASONS]).withMessage(`reason must be one of: ${RETURN_REASONS.join(', ')}`),
    note, validate,
  ],
  controller.createTransfer,
);
router.post(
  '/transfers/:id/receive',
  canReceive,
  [
    id,
    body('quantity').optional().isInt({ min: 0 }).withMessage('quantity must be a whole number, 0 or more').toInt(),
    body('reason').optional({ nullable: true }).isIn([...DISPUTE_REASONS]).withMessage(`reason must be one of: ${DISPUTE_REASONS.join(', ')}`),
    validate,
  ],
  controller.receiveTransfer,
);
router.post(
  '/transfers/:id/resolve',
  canWriteStock,
  [id, body('action').isIn(['return_to_source', 'write_off']).withMessage('action must be return_to_source or write_off'), note, validate],
  controller.resolveTransfer,
);
router.post('/transfers/:id/cancel', canWriteStock, [id, validate], controller.cancelTransfer);
router.post(
  '/adjust',
  canWriteStock,
  [
    intField('locationId'), intField('productId'), intField('newQuantity', 0),
    body('reason').isIn([...ADJUST_REASONS]).withMessage(`reason must be one of: ${ADJUST_REASONS.join(', ')}`),
    note, validate,
  ],
  controller.adjustStock,
);

export default router;
