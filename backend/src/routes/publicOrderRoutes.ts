import { Router } from 'express';
import * as publicOrderController from '../controllers/publicOrderController';
import { webhookLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validation';
import { body, query, param } from 'express-validator';

const router = Router();

// Apply rate limiting to all public routes
router.use(webhookLimiter);

// Validation rules
const getFormValidation = [
  param('slug').notEmpty().withMessage('Form slug is required')
    .matches(/^[a-z0-9-]+$/).withMessage('Invalid slug format')
];

const createOrderValidation = [
  param('slug').notEmpty().withMessage('Form slug is required'),
  body('formData').isObject().withMessage('Form data is required'),
  body('formData.name').notEmpty().withMessage('First name is required'),
  body('formData.phoneNumber').notEmpty().withMessage('Phone number is required')
    .matches(/^\+?[0-9]{8,15}$/).withMessage('Invalid phone number format'),
  body('formData.alternatePhone').optional()
    .matches(/^\+?[0-9]{8,15}$/).withMessage('Invalid alternate phone number format'),
  body('formData.email').optional({ nullable: true, checkFalsy: true }).isEmail().withMessage('Invalid email format'),
  body('formData.address').notEmpty().withMessage('Address is required'),
  body('formData.state').notEmpty().withMessage('State is required'),
  body('selectedPackage').isObject().withMessage('Package selection is required'),
  body('selectedPackage.name').notEmpty().withMessage('Package name is required'),
  body('selectedPackage.price').isFloat({ min: 0 }).withMessage('Package price must be positive'),
  body('selectedPackage.quantity').isInt({ min: 1 }).withMessage('Package quantity must be at least 1'),
  body('selectedUpsells').optional().isArray().withMessage('Upsells must be an array'),
  body('totalAmount').isFloat({ min: 0 }).withMessage('Total amount must be positive')
];

const trackOrderValidation = [
  query('orderNumber').notEmpty().withMessage('Order number is required'),
  query('phoneNumber').notEmpty().withMessage('Phone number is required')
    .matches(/^\+?[0-9]{8,15}$/).withMessage('Invalid phone number format')
];

// Routes - All public (no authentication required)

// Get checkout form by slug
router.get(
  '/forms/:slug',
  getFormValidation,
  validate,
  publicOrderController.getPublicForm
);

// Create order from checkout form
router.post(
  '/forms/:slug/orders',
  createOrderValidation,
  validate,
  publicOrderController.createPublicOrder
);

// Track order by order number and phone
router.get(
  '/orders/track',
  trackOrderValidation,
  validate,
  publicOrderController.trackOrder
);

export default router;
