import { Router } from 'express';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { getRates, postRate, postUseToday, getHistory } from '../controllers/fxController';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// Same permissions as Settings: read needs settings:view, writes need settings:update.
router.get('/rates', requireResourcePermission('settings', 'view'), getRates);
router.get('/history', requireResourcePermission('settings', 'view'), getHistory);
router.post('/rates', requireResourcePermission('settings', 'update'), postRate);
router.post('/use-today', requireResourcePermission('settings', 'update'), postUseToday);

export default router;
