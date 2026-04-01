import { Router } from 'express';
import { apiLimiter } from '../middleware/rateLimiter';
import { authenticate, requireRole } from '../middleware/auth';
import { listPlans, getSubscription, upgradePlan } from '../controllers/billingController';

const router = Router();

router.get('/plans', apiLimiter, listPlans);
router.get('/subscription', apiLimiter, authenticate, getSubscription);
router.post('/upgrade', apiLimiter, authenticate, requireRole('super_admin'), upgradePlan);

export default router;
