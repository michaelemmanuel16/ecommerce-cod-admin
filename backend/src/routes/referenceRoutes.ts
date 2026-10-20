import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getRegions } from '../controllers/referenceController';
import { apiLimiter } from '../middleware/rateLimiter';

const router = Router();

router.get('/regions', apiLimiter, authenticate, getRegions);

export default router;
