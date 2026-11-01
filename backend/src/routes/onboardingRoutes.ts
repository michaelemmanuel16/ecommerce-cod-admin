import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { setupOnboarding, getOnboardingStatus, saveNorthStarStep } from '../controllers/onboardingController';
import { apiLimiter } from '../middleware/rateLimiter';

const router = Router();

router.get('/status', apiLimiter, authenticate, getOnboardingStatus);
router.post('/north-star', apiLimiter, authenticate, requireRole('super_admin'), saveNorthStarStep);
router.post('/setup', apiLimiter, authenticate, requireRole('super_admin'), setupOnboarding);

export default router;
