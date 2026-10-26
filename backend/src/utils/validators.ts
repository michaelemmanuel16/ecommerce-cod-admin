import { canSeeCost } from './costAccess';
import { body, param, query, ValidationChain } from 'express-validator';
import { DeclineReason, FailureReason, OrderStatus } from '@prisma/client';
import { ORDER_FLAG_CODES } from '../services/orderFlagService';
import { ORDER_SORT_FIELDS } from '../services/orderService';
import { CUSTOMER_RISKS, CUSTOMER_SEGMENTS, CUSTOMER_SORT_FIELDS } from '../services/customerService';
import { MONTH_RE } from '../services/kpi/dates';

/**
 * Password validation utility
 * Requirements: 8+ chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
 */
export const validatePassword = (password: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

export const registerTenantValidation: ValidationChain[] = [
  body('adminEmail').isEmail().normalizeEmail(),
  body('adminPassword')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number')
    .matches(/[!@#$%^&*(),.?":{}|<>]/)
    .withMessage('Password must contain at least one special character'),
  body('adminName').notEmpty().trim(),
  body('companyName').notEmpty().trim().isLength({ max: 100 }),
];

export const loginValidation: ValidationChain[] = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
];

/** F-355: a phone with letters is an error; fewer than 9 digits is too short. Spaces, + and dashes are fine (F-362). */
const customerPhone = (field: string) => (v: unknown) => {
  const text = String(v ?? '');
  if (/[a-z]/i.test(text)) throw new Error(`${field} can only have digits, spaces, + and dashes`);
  if (text.replace(/\D/g, '').length < 9) throw new Error(`${field} needs at least 9 digits`);
  return true;
};

export const createCustomerValidation: ValidationChain[] = [
  body('firstName').notEmpty().trim(),
  body('lastName').optional().trim(),
  body('phoneNumber').custom(customerPhone('Phone number')),
  body('alternatePhone').optional({ values: 'falsy' }).custom(customerPhone('Alternate phone')),
  body('address').notEmpty(),
  body('state').notEmpty(),
  body('area').notEmpty()
];

export const updateCustomerValidation: ValidationChain[] = [
  body('phoneNumber').optional().custom(customerPhone('Phone number')),
  body('alternatePhone').optional({ values: 'falsy' }).custom(customerPhone('Alternate phone')),
];


const NO_STOCK_QUANTITY = 'stockQuantity is not accepted. Give openingStock when you create a product, or use Adjust quantity in Inventory.';

// Fields both create and update take (F-601). maxDownloads is the download limit of a digital product (null reads as 5).
const productFieldRules = (): ValidationChain[] => [
  body('stockQuantity').not().exists().withMessage(NO_STOCK_QUANTITY),
  body('lowStockDays').optional({ nullable: true }).isInt({ min: 1, max: 365 }).withMessage('lowStockDays must be a whole number of days, 1 to 365'),
  body('maxDownloads').optional({ nullable: true }).isInt({ min: 1, max: 100 }).withMessage('maxDownloads must be a whole number, 1 to 100'),
  body('downloadLinkExpiryHours').optional({ nullable: true }).isInt({ min: 1 }).withMessage('downloadLinkExpiryHours must be a whole number above 0'),
];

export const createProductValidation: ValidationChain[] = [
  body('sku').notEmpty(),
  body('name').notEmpty(),
  body('category').notEmpty(),
  body('price').isFloat({ min: 0 }),
  // A role that may not see cost sends none (the controller drops it); the product then starts at cost 0
  body('cogs').if((_v, { req }) => canSeeCost(req.user?.role)).isFloat({ min: 0 }),
  ...productFieldRules(),
  body('openingStock').optional().isObject().withMessage('openingStock must be { locationId, quantity }'),
  body('openingStock.locationId').optional().isInt({ min: 1 }).withMessage('openingStock.locationId must be a whole number above 0').toInt(),
  body('openingStock.quantity').if(body('openingStock').exists()).isInt({ min: 0 }).withMessage('openingStock.quantity must be a whole number, 0 or more').toInt(),
];

export const updateProductValidation: ValidationChain[] = [
  body('price').optional().isFloat({ min: 0 }),
  body('cogs').optional().isFloat({ min: 0 }),
  ...productFieldRules(),
];


export const createOrderValidation: ValidationChain[] = [
  body('customerId').optional(),
  // F-317: fewer than 9 digits is an error
  body('customerPhone').optional().custom((v) => String(v).replace(/\D/g, '').length >= 9).withMessage('Phone number needs at least 9 digits'),
  body('orderItems').isArray({ min: 1 }),
  body('orderItems.*.productId').notEmpty(),
  body('orderItems.*.quantity').isInt({ min: 1 }),
  body('subtotal').optional().isFloat({ min: 0 }),
  body('discount').optional().isFloat({ min: 0 }),
  body('totalAmount').isFloat({ min: 0 }),
  body('customerRepId').optional({ nullable: true }).isInt({ min: 1 }),
  body('deliveryAgentId').optional({ nullable: true }).isInt({ min: 1 }),
  body('customerConfirmed').optional().isBoolean().toBoolean(),
  body('deliveryAddress').notEmpty(),
  body('deliveryState').notEmpty(),
  body('deliveryArea').notEmpty()
];

export const ORDER_STATUS_VALUES: string[] = Object.values(OrderStatus);

export const updateOrderStatusValidation: ValidationChain[] = [
  param('id').notEmpty(),
  body('status').isIn(ORDER_STATUS_VALUES),
  body('note').optional().isString().isLength({ max: 500 }),
  body('force').optional().isBoolean().toBoolean(),
  body('reason').optional().isString().isLength({ max: 500 }),
  body('declineReason').optional().isIn(Object.values(DeclineReason)),
  body('failureReason').optional().isIn(Object.values(FailureReason)),
  body('nextAttemptDate').optional({ nullable: true }).isISO8601()
];

export const assignRepValidation: ValidationChain[] = [
  param('id').isInt({ min: 1 }).withMessage('Order id must be a number'),
  body('unassign').optional().equals('both'),
  body('customerRepId').if(body('unassign').not().equals('both')).isInt({ min: 1 }).withMessage('customerRepId must be a number')
];

export const assignAgentValidation: ValidationChain[] = [
  param('id').isInt({ min: 1 }).withMessage('Order id must be a number'),
  body('unassign').optional().equals('both'),
  body('deliveryAgentId').if(body('unassign').not().equals('both')).isInt({ min: 1 }).withMessage('deliveryAgentId must be a number'),
  body('confirmBlocked').optional().isBoolean().toBoolean()
];

export const paginationValidation: ValidationChain[] = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
];

export const productIdValidation: ValidationChain[] = [param('id').isInt({ min: 1 }).withMessage('Invalid product ID').toInt()];

/** Products list and summary filters (F-600). */
export const productListValidation: ValidationChain[] = [
  ...paginationValidation,
  query('tab').optional().isIn(['active', 'archived', 'all']).withMessage('tab must be active, archived or all'),
  query('month').optional().matches(MONTH_RE).withMessage('month must be YYYY-MM'),
];

/** Customers list, tiles and export filters (F-350 to F-353). */
export const customerListValidation: ValidationChain[] = [
  ...paginationValidation,
  query('sortBy').optional().isIn([...CUSTOMER_SORT_FIELDS]).withMessage(`Sort by ${CUSTOMER_SORT_FIELDS.join(', ')}`),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('search').optional().isString().isLength({ max: 100 }),
  query('segment').optional().isIn([...CUSTOMER_SEGMENTS]),
  query('risk').optional().isIn([...CUSTOMER_RISKS]),
  query('blocked').optional().isBoolean(),
  query('flagged').optional().isBoolean(),
];

/** Orders list and tab counts (F-310 to F-312). Counts ignore the sort and page fields. */
export const orderListValidation: ValidationChain[] = [
  ...paginationValidation,
  query('sortBy').optional().isIn([...ORDER_SORT_FIELDS]).withMessage(`Sort by ${ORDER_SORT_FIELDS.join(', ')}`),
  query('search').optional().isString().isLength({ max: 100 }),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('tab').optional().isIn(['unpaid_by_agent']).withMessage('tab must be unpaid_by_agent'),
  query('dateBasis').optional().isIn(['created', 'delivery']),
  query('flag').optional().isIn([...ORDER_FLAG_CODES, 'any']),
  // The orders an import made (F-319): a comma list of ids, numbers only, at most 2,000
  query('ids').optional().isString().matches(/^\d+(,\d+)*$/).withMessage('ids must be a comma list of numbers')
    .custom((v: string) => v.split(',').length <= 2000).withMessage('ids can hold at most 2,000 numbers'),
];

/** `orderIds` length is limited in the service (413 above 200). */
const orderIdsValidation = body('orderIds').isArray({ min: 1 }).withMessage('Select at least one order')
  .custom((ids) => ids.every((id: any) => Number.isInteger(id) && id > 0)).withMessage('All order IDs must be numbers');

export const bulkStatusValidation: ValidationChain[] = [
  orderIdsValidation,
  body('status').isIn(ORDER_STATUS_VALUES),
  body('note').optional().isString().isLength({ max: 500 }),
  body('declineReason').optional().isIn(Object.values(DeclineReason)),
  body('failureReason').optional().isIn(Object.values(FailureReason)),
  body('nextAttemptDate').optional({ nullable: true }).isISO8601()
];

export const bulkAssignValidation: ValidationChain[] = [
  orderIdsValidation,
  body('customerRepId').optional().isInt({ min: 1 }).withMessage('customerRepId must be a number'),
  body('deliveryAgentId').optional().isInt({ min: 1 }).withMessage('deliveryAgentId must be a number'),
  body('unassign').optional().equals('both'),
  body().custom((b) => b.unassign === 'both' || b.customerRepId !== undefined || b.deliveryAgentId !== undefined).withMessage('Choose a call rep or a delivery agent.'),
  body('confirmBlocked').optional().isBoolean().toBoolean(),
];

export const bulkDeleteValidation: ValidationChain[] = [
  body('ids')
    .isArray({ min: 1, max: 100 }).withMessage('Cannot delete more than 100 orders at once')
    .custom((ids) => ids.every((id: any) => typeof id === 'number')).withMessage('All IDs must be numbers')
];

export const forgotPasswordValidation: ValidationChain[] = [
  body('email').isEmail().normalizeEmail()
];

export const resetPasswordValidation: ValidationChain[] = [
  body('token').notEmpty(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number')
    .matches(/[!@#$%^&*(),.?":{}|<>]/)
    .withMessage('Password must contain at least one special character')
];

export const createCallValidation: ValidationChain[] = [
  body('customerId').isInt().withMessage('Customer ID is required'),
  body('orderId').optional().isInt(),
  body('outcome').isIn(['confirmed', 'rescheduled', 'no_answer', 'cancelled', 'other']).withMessage('Invalid call outcome'),
  body('duration').optional().isInt({ min: 0 }).withMessage('Duration must be a positive number'),
  body('notes').optional().isString().isLength({ max: 500 }).withMessage('Notes must be 500 characters or less'),
  body('startedAt').optional().isISO8601().withMessage('startedAt must be an ISO date'),
  body('source').optional().isIn(['manual', 'auto_confirm', 'tap_to_call']).withMessage('Invalid call source')
];

export const createAccountValidation: ValidationChain[] = [
  body('code')
    .trim()
    .notEmpty().withMessage('Account code is required')
    .matches(/^\d{4}$/).withMessage('Account code must be exactly 4 digits'),
  body('name')
    .trim()
    .notEmpty().withMessage('Account name is required')
    .isLength({ min: 3, max: 100 }).withMessage('Account name must be 3-100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),
  body('accountType')
    .notEmpty().withMessage('Account type is required')
    .isIn(['asset', 'liability', 'equity', 'revenue', 'expense']).withMessage('Invalid account type'),
  body('normalBalance')
    .notEmpty().withMessage('Normal balance is required')
    .isIn(['debit', 'credit']).withMessage('Normal balance must be debit or credit'),
  body('parentId')
    .optional()
    .isInt({ min: 1 }).withMessage('Parent ID must be a positive integer')
];

export const updateAccountValidation: ValidationChain[] = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 3, max: 100 }).withMessage('Account name must be 3-100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),
  body('parentId')
    .optional()
    .custom((value) => value === null || (Number.isInteger(Number(value)) && Number(value) > 0))
    .withMessage('Parent ID must be null or a positive integer')
];

export const createJournalEntryValidation: ValidationChain[] = [
  body('entryDate')
    .notEmpty().withMessage('Entry date is required')
    .isISO8601().withMessage('Entry date must be a valid ISO 8601 date'),
  body('description')
    .trim()
    .notEmpty().withMessage('Description is required')
    .isLength({ min: 3, max: 500 }).withMessage('Description must be 3-500 characters'),
  body('transactions')
    .isArray({ min: 2 }).withMessage('At least 2 transactions are required'),
  body('transactions.*.accountId')
    .isInt({ min: 1 }).withMessage('Account ID must be a positive integer'),
  body('transactions.*.debitAmount')
    .isFloat({ min: 0 }).withMessage('Debit amount must be a non-negative number'),
  body('transactions.*.creditAmount')
    .isFloat({ min: 0 }).withMessage('Credit amount must be a non-negative number'),
  body('transactions.*.description')
    .optional()
    .trim()
    .isLength({ max: 255 }).withMessage('Transaction description cannot exceed 255 characters')
];

export const voidJournalEntryValidation: ValidationChain[] = [
  body('voidReason')
    .trim()
    .notEmpty().withMessage('Void reason is required')
    .isLength({ min: 3, max: 500 }).withMessage('Void reason must be 3-500 characters')
];
