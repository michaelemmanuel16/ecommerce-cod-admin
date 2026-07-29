import { Router } from 'express';
import { authenticate, requireResolvedTenant, requirePermission } from '../middleware/auth';
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

router.post('/oauth/initiate', authenticate, requireResolvedTenant, requirePermission(superAdminOnly), initiateOAuth);
router.get('/oauth/phones', authenticate, requireResolvedTenant, requirePermission(superAdminOnly), getPhoneNumbers);
router.post('/oauth/select', authenticate, requireResolvedTenant, requirePermission(superAdminOnly), selectPhoneNumber);
router.delete('/oauth/disconnect', authenticate, requireResolvedTenant, requirePermission(superAdminOnly), disconnectOAuth);
router.get('/oauth/enabled', authenticate, requireResolvedTenant, requirePermission(adminRoles), checkOAuthEnabled);

// Admin endpoints (require auth + admin role)
router.get('/messages', authenticate, requireResolvedTenant, requirePermission(adminRoles), getMessages);
router.get('/messages/:id', authenticate, requireResolvedTenant, requirePermission(adminRoles), getMessageById);
router.post('/send', authenticate, requireResolvedTenant, requirePermission(['super_admin', 'admin']), sendMessage);
router.post('/test', authenticate, requireResolvedTenant, requirePermission(['super_admin', 'admin']), testSend);
router.get('/stats', authenticate, requireResolvedTenant, requirePermission(adminRoles), getStats);
router.get('/status', authenticate, requireResolvedTenant, requirePermission(['super_admin', 'admin']), getStatus);

export default router;
