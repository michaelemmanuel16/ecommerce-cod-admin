import { Router } from 'express';
import { getRevenue, getRates, getLeadership } from '../controllers/kpiController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

const router = Router();

// M1-T15: the KPI layer's HTTP face. Controllers only parse the query; every number comes from services/kpi.
router.use(authenticate);
router.use(tenantRateLimiter);

router.get('/revenue', requireResourcePermission('analytics', 'view'), getRevenue);
router.get('/rates', requireResourcePermission('analytics', 'view'), getRates);
router.get('/leadership', requireResourcePermission('analytics', 'view'), getLeadership);

export default router;
