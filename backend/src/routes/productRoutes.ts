import { NextFunction, Response, Router } from 'express';
import * as productController from '../controllers/productController';
import { authenticate, requireResourcePermission, requireEitherPermission } from '../middleware/auth';
import { AuthRequest } from '../types';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { validate } from '../middleware/validation';
import { createProductValidation, productIdValidation, productListValidation, updateProductValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// Allow access if user has products:view OR orders:create permission
// This enables Sales Reps to see products when creating orders, even without products menu access
router.get('/', productListValidation, validate, requireEitherPermission([
  { resource: 'products', action: 'view' },
  { resource: 'orders', action: 'create' }
]), productController.getAllProducts);
// Starting stock is a stock write: it also needs update_stock
const openingStockNeedsStockRight = (req: AuthRequest, res: Response, next: NextFunction) =>
  req.body?.openingStock ? requireResourcePermission('products', 'update_stock')(req, res, next) : next();
router.post('/', requireResourcePermission('products', 'create'), openingStockNeedsStockRight, createProductValidation, validate, productController.createProduct);
router.get('/summary', productListValidation, validate, requireResourcePermission('products', 'view'), productController.getProductsSummary);
router.get('/low-stock', requireResourcePermission('products', 'view'), productController.getLowStockProducts);
router.get('/:id', productIdValidation, validate, requireResourcePermission('products', 'view'), productController.getProduct);
router.put('/:id', productIdValidation, requireResourcePermission('products', 'update'), updateProductValidation, validate, productController.updateProduct);
router.post('/:id/archive', productIdValidation, validate, requireResourcePermission('products', 'update'), productController.archiveProduct);
router.post('/:id/restore', productIdValidation, validate, requireResourcePermission('products', 'update'), productController.restoreProduct);
router.delete('/:id', productIdValidation, validate, requireResourcePermission('products', 'delete'), productController.deleteProduct);

export default router;
