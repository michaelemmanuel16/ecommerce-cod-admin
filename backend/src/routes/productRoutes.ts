import { Router } from 'express';
import * as productController from '../controllers/productController';
import { authenticate, requirePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { createProductValidation, paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

router.get('/', paginationValidation, validate, productController.getAllProducts);
router.post('/', requirePermission(['super_admin', 'admin', 'inventory_manager']), createProductValidation, validate, productController.createProduct);
router.get('/low-stock', productController.getLowStockProducts);
router.get('/:id', productController.getProduct);
router.put('/:id', requirePermission(['super_admin', 'admin', 'inventory_manager']), productController.updateProduct);
router.delete('/:id', requirePermission(['super_admin', 'admin']), productController.deleteProduct);
router.patch('/:id/stock', requirePermission(['super_admin', 'admin', 'inventory_manager']), productController.updateProductStock);

export default router;
