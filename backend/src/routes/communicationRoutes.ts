import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as ctrl from '../controllers/communicationController';

const router = Router();
router.use(authenticate);

router.get('/messages', ctrl.getMessages);
router.get('/stats', ctrl.getStats);
router.get('/recipients', ctrl.getRecipients);
router.get('/sms-templates', ctrl.getTemplates);
router.post('/sms-templates', requireRole('super_admin', 'admin'), ctrl.createTemplate);
router.put('/sms-templates/:id', requireRole('super_admin', 'admin'), ctrl.updateTemplate);
router.delete('/sms-templates/:id', requireRole('super_admin', 'admin'), ctrl.deleteTemplate);
router.post('/bulk-sms', requireRole('super_admin', 'admin'), ctrl.bulkSendSms);
router.post('/bulk-whatsapp', requireRole('super_admin', 'admin'), ctrl.bulkSendWhatsApp);
router.get('/opt-outs', ctrl.getOptOutCustomers);
router.patch('/opt-out/:customerId', requireRole('super_admin', 'admin'), ctrl.updateOptOut);

export default router;
