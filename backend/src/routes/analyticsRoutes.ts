import { Router } from 'express';
import * as analyticsController from '../controllers/analyticsController';
import { authenticate, requirePermission } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/dashboard', analyticsController.getDashboardMetrics);
router.get('/sales-trends', analyticsController.getSalesTrends);
router.get('/conversion-funnel', analyticsController.getConversionFunnel);
router.get('/rep-performance', requirePermission(['super_admin', 'admin', 'manager']), analyticsController.getRepPerformance);
router.get('/agent-performance', requirePermission(['super_admin', 'admin', 'manager']), analyticsController.getAgentPerformance);
router.get('/customer-insights', analyticsController.getCustomerInsights);

export default router;
