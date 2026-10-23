import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { validate } from '../middleware/validation';
import { registerTenantValidation, loginValidation, forgotPasswordValidation, resetPasswordValidation } from '../utils/validators';
import { requireSaasSignup } from '../middleware/requireSaasSignup';
import { authLimiter, registrationLimiter, apiLimiter, changePasswordLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/register-tenant', requireSaasSignup, registrationLimiter, registerTenantValidation, validate, authController.registerTenant);
router.post('/login', authLimiter, loginValidation, validate, authController.login);
router.post('/refresh', authLimiter, authController.refresh);
router.post('/forgot-password', authLimiter, forgotPasswordValidation, validate, authController.forgotPassword);
router.post('/reset-password', authLimiter, resetPasswordValidation, validate, authController.resetPassword);
router.post('/logout', apiLimiter, authenticate, authController.logout);
router.post('/change-password', authenticate, changePasswordLimiter, authController.changePassword);
router.get('/sessions', apiLimiter, authenticate, authController.listSessions);
router.post('/sessions/revoke-others', apiLimiter, authenticate, authController.revokeOtherSessions);
router.delete('/sessions/:id', apiLimiter, authenticate, authController.revokeSession);
router.get('/me', apiLimiter, authenticate, authController.me);
// Wrong passwords share the 5-tries-per-15-minutes limit (F-1226)
router.delete('/delete-account', authenticate, requireSuperAdmin, changePasswordLimiter, authController.deleteTenantAccount);

export default router;
