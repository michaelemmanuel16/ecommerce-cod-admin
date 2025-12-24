import { Router } from 'express';
import * as productController from '../controllers/productController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { createProductValidation, paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

router.get('/', paginationValidation, validate, requireResourcePermission('products', 'view'), productController.getAllProducts);
router.post('/', requireResourcePermission('products', 'create'), createProductValidation, validate, productController.createProduct);
router.get('/low-stock', requireResourcePermission('products', 'view'), productController.getLowStockProducts);
router.get('/:id', requireResourcePermission('products', 'view'), productController.getProduct);
router.put('/:id', requireResourcePermission('products', 'update'), productController.updateProduct);
router.delete('/:id', requireResourcePermission('products', 'delete'), productController.deleteProduct);
router.patch('/:id/stock', requireResourcePermission('products', 'update_stock'), productController.updateProductStock);

export default router;
