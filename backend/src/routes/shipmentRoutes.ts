import { Router } from 'express';
import { body, param, query } from 'express-validator';
import * as controller from '../controllers/shipmentController';
import { authenticate, requireResourcePermission, requireStockView } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate } from '../middleware/validation';
import { CLAIM_ACTIONS } from '../services/shipmentService';
import { COUNT_SOURCES } from '../services/stockCountService';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// F-604 to F-608, F-600: products:view reads, but never a call rep or a delivery agent (they get no cost); the owner, an admin and a stock keeper write (products:update_stock).
const canView = requireStockView;
const canWrite = requireResourcePermission('products', 'update_stock');

const id = param('id').isInt({ min: 1 }).withMessage('Invalid shipment ID').toInt();
const money = (name: string) => body(name).optional({ nullable: true, values: 'falsy' }).isFloat({ min: 0 }).withMessage(`${name} must be a number, 0 or more`);
const fields = [
  body('quantity').optional().isInt({ min: 1 }).withMessage('quantity must be a whole number above 0').toInt(),
  money('unitCost'), money('shippingCost'), money('customsDuties'), money('otherCosts'),
  body('currency').optional({ nullable: true, values: 'falsy' }).isString().matches(/^[A-Za-z]{3}$/).withMessage('currency must be a 3-letter currency code'),
  body('fxRate').optional({ nullable: true, values: 'falsy' }).isFloat({ gt: 0 }).withMessage('fxRate must be a number above 0'),
  body('supplier').optional({ nullable: true }).isString().trim().isLength({ max: 200 }),
  body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 1000 }),
  body('expectedArrivalDate').optional({ nullable: true, values: 'falsy' }).isISO8601().withMessage('expectedArrivalDate must be a date'),
];

router.get('/', canView, [query('status').optional().isIn(['pending', 'arrived', 'received']), query('productId').optional().isInt({ min: 1 }), validate], controller.listShipments);
router.get('/summary', canView, controller.getSummary);
router.get('/:id', canView, [id, validate], controller.getShipment);
router.post('/', canWrite, [body('productId').isInt({ min: 1 }).withMessage('productId is required').toInt(), body('quantity').exists().withMessage('quantity is required'), ...fields, validate], controller.createShipment);
router.patch('/:id', canWrite, [id, ...fields, validate], controller.updateShipment);
router.delete('/:id', canWrite, [id, validate], controller.deleteShipment);
router.post(
  '/:id/receive',
  canWrite,
  [
    id,
    body('locationId').isInt({ min: 1 }).withMessage('locationId is required').toInt(),
    body('receivedAt').isISO8601().withMessage('receivedAt must be a date'),
    body('quantityCounted').isInt({ min: 0 }).withMessage('quantityCounted must be a whole number, 0 or more').toInt(),
    body('countSource').isIn([...COUNT_SOURCES]).withMessage(`countSource must be one of: ${COUNT_SOURCES.join(', ')}`),
    body('note').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body('fxRate').optional({ nullable: true, values: 'falsy' }).isFloat({ gt: 0 }).withMessage('fxRate must be a number above 0'),
    validate,
  ],
  controller.receiveShipment,
);
router.post(
  '/:id/claim',
  canWrite,
  [
    id,
    body('action').isIn([...CLAIM_ACTIONS]).withMessage('action must be settle or write_off'),
    body('amountRecovered').if(body('action').equals('settle')).isFloat({ gt: 0 }).withMessage('amountRecovered must be a number above 0'),
    body('note').optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    validate,
  ],
  controller.settleClaim,
);

export default router;
