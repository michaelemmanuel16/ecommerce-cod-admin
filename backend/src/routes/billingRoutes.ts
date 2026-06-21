import { Router } from 'express';
import { apiLimiter } from '../middleware/rateLimiter';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listPlans,
  getSubscription,
  startSubscription,
  verifySubscription,
  cancelSubscription,
} from '../controllers/billingController';

const router = Router();

router.get('/plans', apiLimiter, listPlans);
router.get('/subscription', apiLimiter, authenticate, getSubscription);

// SaaS subscription lifecycle (MAN-61) — super_admin only.
router.post('/start-subscription', apiLimiter, authenticate, requireRole('super_admin'), startSubscription);
router.get('/verify-subscription/:reference', apiLimiter, authenticate, requireRole('super_admin'), verifySubscription);
router.post('/cancel-subscription', apiLimiter, authenticate, requireRole('super_admin'), cancelSubscription);

export default router;
