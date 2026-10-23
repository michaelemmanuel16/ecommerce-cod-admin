import { Router } from 'express';
import * as controller from '../controllers/deliveryPartnerController';
import { authenticate, requireRole } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// F-700: owner, admin, manager, finance clerk and stock keeper read. Fee and revenue fields still need financial:view
// (the controller leaves them out for the stock keeper). F-715: owner, admin, manager.
const canRead = requireRole('super_admin', 'admin', 'manager', 'accountant', 'inventory_manager');
const canOversee = requireRole('super_admin', 'admin', 'manager');

router.get('/', canRead, controller.list);
router.get('/summary', canRead, controller.summary);
router.get('/waiting', canOversee, controller.waiting);
router.get('/failure-reasons', canRead, controller.failureReasons);

export default router;
