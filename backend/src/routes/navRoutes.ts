import { Router } from 'express';
import * as navController from '../controllers/navController';
import { authenticate } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

router.get('/counts', navController.getCounts);

export default router;
