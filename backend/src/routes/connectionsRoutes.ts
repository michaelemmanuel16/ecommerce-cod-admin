import { Router } from 'express';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { authenticate, requireResourcePermission, requireRole } from '../middleware/auth';
import * as ctrl from '../controllers/connectionsController';

// M9-T26, T29: the Connections page data
const router = Router();
router.use(authenticate);
router.use(tenantRateLimiter);

// Anyone who can view settings sees the cards; the activity log is for the owner and admins
router.get('/', requireResourcePermission('settings', 'view'), ctrl.list);
router.get('/activity', requireRole('super_admin', 'admin'), ctrl.activity);
router.get('/csv/template', requireResourcePermission('settings', 'view'), ctrl.csvTemplate);

export default router;
