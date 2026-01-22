import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { registerValidation, loginValidation } from '../utils/validators';
import { authLimiter, apiLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/register', authLimiter, registerValidation, validate, authController.register);
router.post('/login', authLimiter, loginValidation, validate, authController.login);
router.post('/refresh', authLimiter, authController.refresh);
router.post('/logout', apiLimiter, authenticate, authController.logout);
router.get('/me', apiLimiter, authenticate, authController.me);

export default router;
