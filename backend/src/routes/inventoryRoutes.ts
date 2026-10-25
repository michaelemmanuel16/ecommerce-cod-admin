import { NextFunction, Response, Router } from 'express';
import { body, param, query } from 'express-validator';
import * as controller from '../controllers/inventoryController';
import { authenticate, requireResourcePermission, requireStockView } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';
import { YMD } from '../services/kpi/dates';
import { AuthRequest } from '../types';
import { COUNT_REASONS, COUNT_SOURCES } from '../services/stockCountService';
import { TransferStatus, TransferType, StockLocationType } from '@prisma/client';
import { ADJUST_REASONS, CREATE_TYPES, DISPUTE_REASONS, RETURN_REASONS } from '../services/transferService';
import { locationOfUser } from '../services/inventoryReadService';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// F-654, F-655: the owner, an admin and a stock keeper write stock (products:update_stock).
const canWriteStock = requireResourcePermission('products', 'update_stock');
// A delivery agent confirms stock addressed to them; the service checks it is theirs.
const canReceive = (req: AuthRequest, res: Response, next: NextFunction) =>
  req.user?.role === 'delivery_agent' ? next() : canWriteStock(req, res, next);

// Reads: requireStockView (products:view, never a call rep or a delivery agent, F-600).
const canView = requireStockView;
// The one exception: a delivery agent reads /levels and /transfers for their own stock location only (F-653). The agent's
// location goes to the service as req.scopeLocationId, and another location is 403. Every other role takes canView.
const canViewOrOwn = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'delivery_agent') return canView(req, res, next);
  const own = await locationOfUser(req.user.id);
  if (own == null) return res.status(403).json({ error: 'You have no stock location' });
  const asked = req.query.locationId;
  if (asked !== undefined && asked !== '' && Number(asked) !== own) return res.status(403).json({ error: 'You can only see your own stock' });
  req.scopeLocationId = own;
  return next();
};
// The CSV export: owner, admin and finance clerk (F-659).
const canExport = (req: AuthRequest, res: Response, next: NextFunction) =>
  ['super_admin', 'admin', 'accountant'].includes(req.user?.role ?? '') ? next() : res.status(403).json({ error: 'You do not have access to the export' });

const id = param('id').isInt({ min: 1 }).withMessage('Invalid transfer ID').toInt();
const countId = param('id').isInt({ min: 1 }).withMessage('Invalid count ID').toInt();
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

// Set up the own store (F-652)
router.post('/locations', canWriteStock, [body('name').isString().trim().isLength({ min: 1, max: 100 }).withMessage('Give the store a name'), body('address').optional({ nullable: true }).isString().trim().isLength({ max: 200 }), validate], controller.createOwnStore);

// Reads (F-651, F-652, F-603, F-659, F-656)
const optInt = (name: string) => query(name).optional().isInt({ min: 1 }).withMessage(`${name} must be a whole number above 0`);
const optDay = (name: string) => query(name).optional().matches(YMD).withMessage(`${name} must be a date, YYYY-MM-DD`);
router.get(
  '/overview',
  canView,
  [optInt('product'), query('type').optional().isIn(Object.values(StockLocationType)), query('onlyDifferences').optional().isBoolean(), validate],
  controller.overview,
);
router.get('/levels', canViewOrOwn, [optInt('locationId'), optInt('productId'), validate], controller.levels);
router.get('/product/:productId/holders', canView, [param('productId').isInt({ min: 1 }).withMessage('Invalid product ID').toInt(), validate], controller.holders);
const transferFilterRules = [
  query('type').optional().isIn(Object.values(TransferType)).withMessage('Unknown type'),
  query('status').optional().isIn(Object.values(TransferStatus)).withMessage('Unknown status'),
  optInt('locationId'), optInt('productId'), optDay('from'), optDay('to'),
];
router.get(
  '/transfers',
  canViewOrOwn,
  [
    ...transferFilterRules,
    query('includeCounts').optional().isBoolean(), ...paginationValidation, validate,
  ],
  controller.listTransfers,
);
router.get(
  '/transfers/export.csv',
  canView, canExport,
  [...transferFilterRules, validate],
  controller.exportTransfers,
);
router.get('/locations', canView, controller.listLocations);
router.get('/transfers/:id/trail', canView, [id, validate], controller.transferTrail);
router.get('/returns/summary', canView, [optDay('from'), optDay('to'), optInt('partnerId'), validate], controller.returnsSummary);

// Stock counts (F-653)
router.post(
  '/counts',
  canWriteStock,
  [
    intField('locationId'),
    body('countDate').matches(YMD).withMessage('countDate must be a date, YYYY-MM-DD'),
    body('source').isIn(COUNT_SOURCES).withMessage(`source must be one of: ${COUNT_SOURCES.join(', ')}`),
    note,
    body('lines').isArray({ min: 1 }).withMessage('A count needs at least one product'),
    body('lines.*.productId').isInt({ min: 1 }).withMessage('productId must be a whole number above 0').toInt(),
    body('lines.*.countedQuantity').isInt({ min: 0 }).withMessage('countedQuantity must be a whole number, 0 or more').toInt(),
    validate,
  ],
  controller.createCount,
);
router.get(
  '/counts',
  canView,
  [optInt('locationId'), ...paginationValidation, validate],
  controller.listCounts,
);
router.get('/counts/:id', canView, [countId, validate], controller.getCount);
router.post(
  '/counts/:id/lines/:lineId/apply',
  canWriteStock,
  [
    countId, param('lineId').isInt({ min: 1 }).withMessage('Invalid line ID').toInt(),
    body('reason').optional().isIn([...COUNT_REASONS]).withMessage(`reason must be one of: ${COUNT_REASONS.join(', ')}`),
    body('shipmentId').optional({ nullable: true }).isInt({ min: 1 }).toInt(),
    note, validate,
  ],
  controller.applyCountLine,
);

export default router;
