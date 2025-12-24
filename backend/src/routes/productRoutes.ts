import { Router } from 'express';
import * as productController from '../controllers/productController';
import { authenticate, requireResourcePermission, requireEitherPermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { createProductValidation, paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

// Allow access if user has products:view OR orders:create permission
// This enables Sales Reps to see products when creating orders, even without products menu access
router.get('/', paginationValidation, validate, requireEitherPermission([
  { resource: 'products', action: 'view' },
  { resource: 'orders', action: 'create' }
]), productController.getAllProducts);
router.post('/', requireResourcePermission('products', 'create'), createProductValidation, validate, productController.createProduct);
router.get('/low-stock', requireResourcePermission('products', 'view'), productController.getLowStockProducts);
router.get('/:id', requireResourcePermission('products', 'view'), productController.getProduct);
router.put('/:id', requireResourcePermission('products', 'update'), productController.updateProduct);
router.delete('/:id', requireResourcePermission('products', 'delete'), productController.deleteProduct);
router.patch('/:id/stock', requireResourcePermission('products', 'update_stock'), productController.updateProductStock);

export default router;
