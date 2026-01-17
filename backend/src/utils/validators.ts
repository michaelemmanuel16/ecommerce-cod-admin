import { body, param, query, ValidationChain } from 'express-validator';

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

export const registerValidation: ValidationChain[] = [
  body('email').isEmail().normalizeEmail(),
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
    .withMessage('Password must contain at least one special character'),
  body('firstName').notEmpty().trim(),
  body('lastName').notEmpty().trim(),
  body('role').isIn(['super_admin', 'admin', 'manager', 'sales_rep', 'inventory_manager', 'delivery_agent', 'accountant'])
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

export const updateOrderStatusValidation: ValidationChain[] = [
  param('id').notEmpty(),
  body('status').isIn([
    'pending_confirmation',
    'confirmed',
    'preparing',
    'ready_for_pickup',
    'out_for_delivery',
    'delivered',
    'cancelled',
    'returned',
    'failed_delivery'
  ])
];

export const paginationValidation: ValidationChain[] = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 })
];

export const bulkDeleteValidation: ValidationChain[] = [
  body('ids')
    .isArray({ min: 1, max: 100 }).withMessage('Cannot delete more than 100 orders at once')
    .custom((ids) => ids.every((id: any) => typeof id === 'number')).withMessage('All IDs must be numbers')
];

export const createCallValidation: ValidationChain[] = [
  body('customerId').isInt().withMessage('Customer ID is required'),
  body('orderId').optional().isInt(),
  body('outcome').isIn(['confirmed', 'rescheduled', 'no_answer', 'cancelled', 'other']).withMessage('Invalid call outcome'),
  body('duration').optional().isInt({ min: 0 }).withMessage('Duration must be a positive number'),
  body('notes').optional().isString().isLength({ max: 500 }).withMessage('Notes must be 500 characters or less')
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
