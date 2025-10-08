import { Router } from 'express';
import * as deliveryController from '../controllers/deliveryController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { paginationValidation } from '../utils/validators';

const router = Router();

router.use(authenticate);

router.get('/', paginationValidation, validate, deliveryController.getAllDeliveries);
router.get('/routes/:agentId', deliveryController.getAgentRoute);
router.get('/:id', deliveryController.getDelivery);
router.patch('/:id/proof', deliveryController.uploadProofOfDelivery);
router.patch('/:id/complete', deliveryController.completeDelivery);

export default router;
