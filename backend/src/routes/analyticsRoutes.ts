import { Router } from 'express';
import * as analyticsController from '../controllers/analyticsController';
import { authenticate, requirePermission } from '../middleware/auth';
import cacheMiddleware from '../middleware/cache';

const router = Router();

router.use(authenticate);

// Cache analytics endpoints (5 minutes default)
router.get('/dashboard', cacheMiddleware(120), analyticsController.getDashboardMetrics);
router.get('/sales-trends', cacheMiddleware(300), analyticsController.getSalesTrends);
router.get('/conversion-funnel', cacheMiddleware(300), analyticsController.getConversionFunnel);
router.get('/rep-performance', requirePermission(['super_admin', 'admin', 'manager']), cacheMiddleware(300), analyticsController.getRepPerformance);
router.get('/agent-performance', requirePermission(['super_admin', 'admin', 'manager']), cacheMiddleware(300), analyticsController.getAgentPerformance);
router.get('/customer-insights', cacheMiddleware(600), analyticsController.getCustomerInsights);

export default router;
