import { body, param, query, ValidationChain } from 'express-validator';
import { DeclineReason, FailureReason, OrderStatus } from '@prisma/client';
import { ORDER_FLAG_CODES } from '../services/orderFlagService';
import { ORDER_SORT_FIELDS } from '../services/orderService';

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

export const createCustomerValidation: ValidationChain[] = [
  body('firstName').notEmpty().trim(),
  body('lastName').optional().trim(),
  body('phoneNumber').isMobilePhone('any'),
  body('address').notEmpty(),
  body('state').notEmpty(),
  body('area').notEmpty()
];

export const createProductValidation: ValidationChain[] = [
  body('sku').notEmpty(),
  body('name').notEmpty(),
  body('category').notEmpty(),
  body('price').isFloat({ min: 0 }),
  body('cogs').isFloat({ min: 0 }),
  body('stockQuantity').isInt({ min: 0 })
];

export const createOrderValidation: ValidationChain[] = [
  body('customerId').optional(),
  body('customerPhone').optional(),
  body('orderItems').isArray({ min: 1 }),
  body('orderItems.*.productId').notEmpty(),
  body('orderItems.*.quantity').isInt({ min: 1 }),
  body('subtotal').isFloat({ min: 0 }),
  body('totalAmount').isFloat({ min: 0 }),
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

/** Orders list and tab counts (F-310 to F-312). Counts ignore the sort and page fields. */
export const orderListValidation: ValidationChain[] = [
  ...paginationValidation,
  query('sortBy').optional().isIn([...ORDER_SORT_FIELDS]).withMessage(`Sort by ${ORDER_SORT_FIELDS.join(', ')}`),
  query('search').optional().isString().isLength({ max: 100 }),
  query('sortOrder').optional().isIn(['asc', 'desc']),
  query('dateBasis').optional().isIn(['created', 'delivery']),
  query('flag').optional().isIn([...ORDER_FLAG_CODES, 'any']),
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
  body('sourceType')
    .notEmpty().withMessage('Source type is required')
    .isIn(['order_delivery', 'agent_deposit', 'expense', 'payout', 'manual', 'reversal'])
    .withMessage('Invalid source type'),
  body('sourceId')
    .optional()
    .isInt({ min: 1 }).withMessage('Source ID must be a positive integer'),
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
