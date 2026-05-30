import { Router } from 'express';
import { apiLimiter } from '../middleware/rateLimiter';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listPlans,
  getSubscription,
  startSubscription,
  cancelSubscription,
  upgradePlan,
} from '../controllers/billingController';

const router = Router();

router.get('/plans', apiLimiter, listPlans);
router.get('/subscription', apiLimiter, authenticate, getSubscription);
router.post('/start-subscription/:planId', apiLimiter, authenticate, requireRole('super_admin', 'admin'), startSubscription);
router.post('/cancel-subscription', apiLimiter, authenticate, requireRole('super_admin', 'admin'), cancelSubscription);
router.post('/upgrade', apiLimiter, authenticate, requireRole('super_admin'), upgradePlan);

export default router;
