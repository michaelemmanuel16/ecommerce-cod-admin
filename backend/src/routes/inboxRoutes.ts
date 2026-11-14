import { Router } from 'express';
import * as controller from '../controllers/inboxController';
import { authenticate } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// M9-T17: every row belongs to one person; the feed shows only the caller's rows (the owner may ask for scope=all)
router.get('/', controller.list);
router.get('/counts', controller.counts);
router.post('/mark-all', controller.markAll);
router.patch('/:id', controller.patch);

export default router;
