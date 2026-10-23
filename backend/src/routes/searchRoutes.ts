import { Router } from 'express';
import * as searchController from '../controllers/searchController';
import { authenticate } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

router.get('/', searchController.search);

export default router;
