import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { param } from 'express-validator';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { initiate, pickList, pickSave, list, toggle, remove, refresh } from '../controllers/metaAdsController';

const router = Router();

// The OAuth callback is registered in server.ts (unauthenticated; the CSRF state validates it)
const canView = requireResourcePermission('marketing', 'view');
const canUpdate = requireResourcePermission('marketing', 'update');

// Refresh now: one per ad account per 5 minutes (a pull is a few Meta calls; the daily job does the rest)
const refreshLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 1,
  keyGenerator: (req: any) => `meta-refresh:${req.user?.tenantId ?? ''}:${req.params.id}`, // validated and parsed before this runs
  message: { error: 'Refresh again in a few minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/oauth/initiate', authenticate, canUpdate, initiate);
router.get('/oauth/pick/:pickId', authenticate, canUpdate, pickList);
router.post('/oauth/pick/:pickId', authenticate, canUpdate, pickSave);
router.get('/accounts', authenticate, canView, list);
router.patch('/accounts/:id', authenticate, canUpdate, toggle);
router.delete('/accounts/:id', authenticate, canUpdate, remove);
router.post('/accounts/:id/refresh', authenticate, canUpdate, [param('id').isInt({ min: 1 }).toInt()], validate, refreshLimiter, refresh);

export default router;
