import { Router } from 'express';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import * as controller from '../controllers/partnerSettlementController';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// F-906: an outside agent records a payout with a key that holds the payout permission (decision O7)
router.post('/', requireResourcePermission('payouts', 'create'), controller.record);

export default router;
