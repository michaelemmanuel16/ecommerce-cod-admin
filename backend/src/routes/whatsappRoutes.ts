import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import {
  verifyWebhook,
  handleWebhook,
  getMessages,
  getMessageById,
  sendMessage,
  getStats,
  testSend,
  getStatus,
} from '../controllers/whatsappController';
import { UserRole } from '@prisma/client';

const router = Router();

// Public webhook endpoints (no auth — called by WhatsApp)
// Raw body is captured via express.json verify callback in server.ts for HMAC verification.
router.get('/webhook', verifyWebhook);
router.post('/webhook', handleWebhook);

// Admin endpoints (require auth + admin role)
const adminRoles: UserRole[] = ['super_admin', 'admin', 'manager'];

router.get('/messages', authenticate, requirePermission(adminRoles), getMessages);
router.get('/messages/:id', authenticate, requirePermission(adminRoles), getMessageById);
router.post('/send', authenticate, requirePermission(['super_admin', 'admin']), sendMessage);
router.post('/test', authenticate, requirePermission(['super_admin', 'admin']), testSend);
router.get('/stats', authenticate, requirePermission(adminRoles), getStats);
router.get('/status', authenticate, requirePermission(['super_admin', 'admin']), getStatus);

export default router;
