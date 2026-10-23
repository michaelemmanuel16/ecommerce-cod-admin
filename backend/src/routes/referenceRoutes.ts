import { Router } from 'express';
import { getRegions } from '../controllers/referenceController';
import { apiLimiter } from '../middleware/rateLimiter';

const router = Router();

// Public: the checkout page needs the regions without a login. A token only supplies the store's country.
router.get('/regions', apiLimiter, getRegions);

export default router;
