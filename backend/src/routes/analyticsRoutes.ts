import { Router } from 'express';
import * as analyticsController from '../controllers/analyticsController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import cacheMiddleware from '../middleware/cache';
import { apiLimiter } from '../middleware/rateLimiter';

const router = Router();

router.use(authenticate);
router.use(apiLimiter); // Add rate limiting to prevent DoS on database-heavy queries

// Cache analytics endpoints (5 minutes default)
router.get('/dashboard', requireResourcePermission('analytics', 'view'), cacheMiddleware(120), analyticsController.getDashboardMetrics);
router.get('/sales-trends', requireResourcePermission('analytics', 'view'), cacheMiddleware(300), analyticsController.getSalesTrends);
router.get('/conversion-funnel', requireResourcePermission('analytics', 'view'), cacheMiddleware(300), analyticsController.getConversionFunnel);
router.get('/rep-performance', requireResourcePermission('analytics', 'view'), cacheMiddleware(300), analyticsController.getRepPerformance);
router.get('/agent-performance', requireResourcePermission('analytics', 'view'), cacheMiddleware(300), analyticsController.getAgentPerformance);
router.get('/customer-insights', requireResourcePermission('analytics', 'view'), cacheMiddleware(600), analyticsController.getCustomerInsights);
router.get('/pending-orders', requireResourcePermission('analytics', 'view'), cacheMiddleware(60), analyticsController.getPendingOrders);
router.get('/recent-activity', requireResourcePermission('analytics', 'view'), cacheMiddleware(60), analyticsController.getRecentActivity);

export default router;
