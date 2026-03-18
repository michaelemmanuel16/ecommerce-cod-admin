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
import { UserRole } from '@prisma/client';

const router = Router();

// Webhook endpoints are registered directly in server.ts with a dedicated rate limiter
// (whatsappWebhookLimiter) to handle Meta's burst traffic without apiLimiter blocking.

// Admin endpoints (require auth + admin role)
const adminRoles: UserRole[] = ['super_admin', 'admin', 'manager'];

router.get('/messages', authenticate, requirePermission(adminRoles), getMessages);
router.get('/messages/:id', authenticate, requirePermission(adminRoles), getMessageById);
router.post('/send', authenticate, requirePermission(['super_admin', 'admin']), sendMessage);
router.post('/test', authenticate, requirePermission(['super_admin', 'admin']), testSend);
router.get('/stats', authenticate, requirePermission(adminRoles), getStats);
router.get('/status', authenticate, requirePermission(['super_admin', 'admin']), getStatus);

export default router;
