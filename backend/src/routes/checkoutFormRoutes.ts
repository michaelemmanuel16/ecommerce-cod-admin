import { Router } from 'express';
import * as checkoutFormController from '../controllers/checkoutFormController';
import { authenticate, requirePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { body, query, param } from 'express-validator';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Validation rules
const createFormValidation = [
  body('name').notEmpty().withMessage('Name is required'),
  body('slug').notEmpty().withMessage('Slug is required')
    .matches(/^[a-z0-9-]+$/).withMessage('Slug must be lowercase alphanumeric with hyphens'),
  body('productId').notEmpty().withMessage('Product ID is required'),
  body('fields').isArray().withMessage('Fields must be an array'),
  body('styling').isObject().withMessage('Styling must be an object'),
  body('regions').isObject().withMessage('Regions must be an object'),
  body('packages').isArray({ min: 1 }).withMessage('At least one package is required'),
  body('packages.*.name').notEmpty().withMessage('Package name is required'),
  body('packages.*.price').isFloat({ min: 0 }).withMessage('Package price must be positive'),
  body('packages.*.quantity').isInt({ min: 1 }).withMessage('Package quantity must be at least 1'),
  body('upsells').optional().isArray().withMessage('Upsells must be an array'),
  body('upsells.*.name').optional().notEmpty().withMessage('Upsell name is required'),
  body('upsells.*.description').optional().trim().isLength({ max: 500 }).withMessage('Description must be less than 500 characters'),
  body('upsells.*.imageUrl').optional().custom((value) => {
    if (value && value.includes('..')) {
      throw new Error('Invalid image URL (directory traversal attempt)');
    }
    if (value && !value.match(/^(https?:\/\/.+|\/uploads\/.+)$/)) {
      throw new Error('Image URL must be a valid URL or upload path');
    }
    return true;
  }),
  body('upsells.*.price').optional().isFloat({ min: 0 }).withMessage('Upsell price must be positive'),
  body('upsells.*.items').optional().isObject().withMessage('Upsell items must be an object')
];

const updateFormValidation = [
  body('name').optional().notEmpty().withMessage('Name cannot be empty'),
  body('slug').optional().notEmpty().withMessage('Slug cannot be empty')
    .matches(/^[a-z0-9-]+$/).withMessage('Slug must be lowercase alphanumeric with hyphens'),
  body('productId').optional().notEmpty().withMessage('Product ID cannot be empty'),
  body('fields').optional().isArray().withMessage('Fields must be an array'),
  body('styling').optional().isObject().withMessage('Styling must be an object'),
  body('regions').optional().isObject().withMessage('Regions must be an object'),
  body('packages').optional().isArray().withMessage('Packages must be an array'),
  body('upsells').optional().isArray().withMessage('Upsells must be an array'),
  body('upsells.*.description').optional().trim().isLength({ max: 500 }).withMessage('Description must be less than 500 characters'),
  body('upsells.*.imageUrl').optional().custom((value) => {
    if (value && value.includes('..')) {
      throw new Error('Invalid image URL (directory traversal attempt)');
    }
    if (value && !value.match(/^(https?:\/\/.+|\/uploads\/.+)$/)) {
      throw new Error('Image URL must be a valid URL or upload path');
    }
    return true;
  })
];

const paginationValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
];

const statsValidation = [
  query('startDate').optional().isISO8601().withMessage('Start date must be valid ISO 8601 date'),
  query('endDate').optional().isISO8601().withMessage('End date must be valid ISO 8601 date')
];

// Routes
router.get(
  '/',
  requirePermission(['super_admin', 'admin', 'manager']),
  paginationValidation,
  validate,
  checkoutFormController.getAllCheckoutForms
);

router.get(
  '/:id',
  requirePermission(['super_admin', 'admin', 'manager']),
  param('id').notEmpty().withMessage('Form ID is required'),
  validate,
  checkoutFormController.getCheckoutForm
);

router.post(
  '/',
  requirePermission(['super_admin', 'admin']),
  createFormValidation,
  validate,
  checkoutFormController.createCheckoutForm
);

router.put(
  '/:id',
  requirePermission(['super_admin', 'admin']),
  param('id').notEmpty().withMessage('Form ID is required'),
  updateFormValidation,
  validate,
  checkoutFormController.updateCheckoutForm
);

router.delete(
  '/:id',
  requirePermission(['super_admin', 'admin']),
  param('id').notEmpty().withMessage('Form ID is required'),
  validate,
  checkoutFormController.deleteCheckoutForm
);

router.get(
  '/:id/stats',
  requirePermission(['super_admin', 'admin', 'manager']),
  param('id').notEmpty().withMessage('Form ID is required'),
  statsValidation,
  validate,
  checkoutFormController.getFormStats
);

export default router;
