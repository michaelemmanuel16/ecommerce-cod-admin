import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import {
  getMessages,
  getMessageById,
  sendMessage,
  getStats,
  testSend,
  getStatus,
} from '../controllers/whatsappController';
import {
  initiateOAuth,
  getPhoneNumbers,
  selectPhoneNumber,
  disconnectOAuth,
  checkOAuthEnabled,
} from '../controllers/whatsappOAuthController';
import { UserRole } from '@prisma/client';

const router = Router();

// Webhook endpoints are registered directly in server.ts with a dedicated rate limiter
// (whatsappWebhookLimiter) to handle Meta's burst traffic without apiLimiter blocking.

// OAuth endpoints — callback is registered in server.ts (unauthenticated)
const superAdminOnly: UserRole[] = ['super_admin'];
const adminRoles: UserRole[] = ['super_admin', 'admin', 'manager'];

router.post('/oauth/initiate', authenticate, requirePermission(superAdminOnly), initiateOAuth);
router.get('/oauth/phones', authenticate, requirePermission(superAdminOnly), getPhoneNumbers);
router.post('/oauth/select', authenticate, requirePermission(superAdminOnly), selectPhoneNumber);
router.delete('/oauth/disconnect', authenticate, requirePermission(superAdminOnly), disconnectOAuth);
router.get('/oauth/enabled', authenticate, requirePermission(adminRoles), checkOAuthEnabled);

// Admin endpoints (require auth + admin role)
router.get('/messages', authenticate, requirePermission(adminRoles), getMessages);
router.get('/messages/:id', authenticate, requirePermission(adminRoles), getMessageById);
router.post('/send', authenticate, requirePermission(['super_admin', 'admin']), sendMessage);
router.post('/test', authenticate, requirePermission(['super_admin', 'admin']), testSend);
router.get('/stats', authenticate, requirePermission(adminRoles), getStats);
router.get('/status', authenticate, requirePermission(['super_admin', 'admin']), getStatus);

export default router;
