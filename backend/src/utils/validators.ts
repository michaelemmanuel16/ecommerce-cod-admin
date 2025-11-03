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
  body('lastName').notEmpty().trim(),
  body('phoneNumber').isMobilePhone('any'),
  body('address').notEmpty(),
  body('state').notEmpty(),
  body('zipCode').optional(),
  body('area').notEmpty()
];

export const createProductValidation: ValidationChain[] = [
  body('sku').notEmpty(),
  body('name').notEmpty(),
  body('category').notEmpty(),
  body('price').isFloat({ min: 0 }),
  body('costPrice').isFloat({ min: 0 }),
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
  body('deliveryZipCode').optional(),
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
