import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { getConnections, putConnection, postTestConnection } from '../controllers/paymentConnectionController';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);
// The store owner (super_admin) and admins manage payment accounts (F-400).
router.use(requirePermission(['super_admin', 'admin']));

router.get('/', getConnections);
router.put('/', putConnection);
router.post('/:id/test', postTestConnection);

export default router;
