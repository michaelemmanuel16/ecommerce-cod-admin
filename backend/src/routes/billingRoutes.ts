import { Router } from 'express';
import { apiLimiter } from '../middleware/rateLimiter';
import { authenticate, requireRole } from '../middleware/auth';
import { requireSaasSignup } from '../middleware/requireSaasSignup';
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
// The subscription callback page calls this; it is off with the rest of SaaS signup (F-123).
router.get('/verify-subscription/:reference', requireSaasSignup, apiLimiter, authenticate, requireRole('super_admin'), verifySubscription);
router.post('/cancel-subscription', apiLimiter, authenticate, requireRole('super_admin'), cancelSubscription);

export default router;
