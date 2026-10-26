import { Router } from 'express';
import * as payoutController from '../controllers/payoutController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// One payout API for money out to people (F-913, M5-T19). The permission is `payouts` (view, create); there is no delivery-fee route.
router.get('/', requireResourcePermission('payouts', 'view'), payoutController.listPayouts);
router.get('/owed/:payeeId', requireResourcePermission('payouts', 'view'), payoutController.getOwed);
router.post('/', requireResourcePermission('payouts', 'create'), payoutController.recordPayout);

export default router;
