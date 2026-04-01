import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { registerValidation, registerTenantValidation, loginValidation, forgotPasswordValidation, resetPasswordValidation } from '../utils/validators';
import { authLimiter, registrationLimiter, apiLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/register-tenant', registrationLimiter, registerTenantValidation, validate, authController.registerTenant);
router.post('/register', authLimiter, registerValidation, validate, authController.register);
router.post('/login', authLimiter, loginValidation, validate, authController.login);
router.post('/refresh', authLimiter, authController.refresh);
router.post('/forgot-password', authLimiter, forgotPasswordValidation, validate, authController.forgotPassword);
router.post('/reset-password', authLimiter, resetPasswordValidation, validate, authController.resetPassword);
router.post('/logout', apiLimiter, authenticate, authController.logout);
router.get('/me', apiLimiter, authenticate, authController.me);
router.delete('/delete-account', apiLimiter, authenticate, authController.deleteTenantAccount);

export default router;
