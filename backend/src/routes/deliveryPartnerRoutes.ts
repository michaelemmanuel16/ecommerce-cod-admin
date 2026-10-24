import { Router } from 'express';
import { body } from 'express-validator';
import * as controller from '../controllers/deliveryPartnerController';
import { authenticate, requireRole } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate } from '../middleware/validation';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// F-700: owner, admin, manager, finance clerk and stock keeper read. Fee and revenue fields still need financial:view
// (the controller leaves them out for the stock keeper). F-715 and the region review: owner, admin, manager.
// Edit: owner and admin. The availability switch also takes the agent for self (checked in the service).
const canRead = requireRole('super_admin', 'admin', 'manager', 'accountant', 'inventory_manager');
const canOversee = requireRole('super_admin', 'admin', 'manager');
// Photo links and attempts of a partner's orders: the roles of /api/deliveries/by-order that can also read partners (no agent, no stock keeper).
const canSeeProofs = requireRole('super_admin', 'admin', 'manager', 'accountant');
const canEdit = requireRole('super_admin', 'admin');

const profileFields = [
  body('daysToPay').optional().isInt({ min: 0, max: 365 }).withMessage('Days to pay must be a whole number from 0 to 365').toInt(),
  body('isTrial').optional().isBoolean().withMessage('isTrial must be true or false').toBoolean(),
  body('dataSource').optional().isIn(['app', 'connector', 'csv']).withMessage('dataSource must be app, connector or csv'),
  body('baseTown').optional({ nullable: true }).isString().isLength({ max: 100 }),
  body('vehicleType').optional().isString().isLength({ max: 40 }),
  body('vehicleId').optional({ nullable: true }).isString().isLength({ max: 60 }),
];

// Fixed paths first, then /:id
router.get('/', canRead, controller.list);
router.get('/summary', canRead, controller.summary);
router.get('/waiting', canOversee, controller.waiting);
router.get('/failure-reasons', canRead, controller.failureReasons);
router.get('/region-review', canOversee, controller.regionReview);
router.post(
  '/',
  canEdit,
  [
    body('kind').isIn(['person', 'company']).withMessage('kind must be person or company'),
    body('firstName').isString().trim().notEmpty().isLength({ max: 100 }).withMessage('First name is required'),
    body('lastName').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
    body('email').isEmail().withMessage('A valid email is required').trim(),
    body('phoneNumber').optional({ nullable: true }).isString().isLength({ max: 30 }),
    body('password').optional().isString().isLength({ min: 8, max: 128 }).withMessage('Password must be at least 8 characters'),
    ...profileFields,
    validate,
  ],
  controller.create,
);
router.get('/:id(\\d+)', canRead, controller.getOne);
router.get('/:id(\\d+)/order-proofs', canSeeProofs, controller.orderProofs);
router.patch('/:id(\\d+)', canEdit, [...profileFields, validate], controller.update);
router.patch(
  '/:id(\\d+)/availability',
  requireRole('super_admin', 'admin', 'manager', 'delivery_agent'),
  [body('isAvailable').isBoolean({ strict: true }).withMessage('isAvailable must be true or false'), validate],
  controller.availability,
);

export default router;
