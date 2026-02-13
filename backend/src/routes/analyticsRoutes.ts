
import { Router } from 'express';
import {
    getDashboardMetrics,
    getSalesTrends,
    getConversionFunnel,
    getRepPerformance,
    getAgentPerformance,
    getCustomerInsights,
    getPendingOrders,
    getRecentActivity,
    getOrderStatusDistribution,
    getProductPerformance,
    getAreaDistribution
} from '../controllers/analyticsController';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import cacheMiddleware from '../middleware/cache';
import { apiLimiter } from '../middleware/rateLimiter';
import { query } from 'express-validator';
import { validate } from '../middleware/validation';

const router = Router();

router.use(apiLimiter); // Add rate limiting to prevent DoS on database-heavy queries
router.use(authenticate);

// Reusable date range validators
const dateRangeValidators = [
  query('startDate').optional().isISO8601().withMessage('startDate must be a valid ISO8601 date').toDate(),
  query('endDate').optional().isISO8601().withMessage('endDate must be a valid ISO8601 date').toDate(),
  validate,
];

// Cache analytics endpoints (5 minutes default)
router.get('/dashboard', requireResourcePermission('analytics', 'view'), cacheMiddleware(300), getDashboardMetrics);
router.get('/sales-trends', requireResourcePermission('analytics', 'view'), cacheMiddleware(300), getSalesTrends);
router.get('/conversion-funnel', requireResourcePermission('analytics', 'view'), cacheMiddleware(300), getConversionFunnel);
router.get('/rep-performance', requireResourcePermission('analytics', 'view'), cacheMiddleware(300), getRepPerformance);
router.get('/agent-performance', requireResourcePermission('analytics', 'view'), cacheMiddleware(300), getAgentPerformance);
router.get('/customer-insights', requireResourcePermission('analytics', 'view'), cacheMiddleware(600), getCustomerInsights);
router.get('/pending-orders', requireResourcePermission('analytics', 'view'), cacheMiddleware(60), getPendingOrders);
router.get('/recent-activity', requireResourcePermission('analytics', 'view'), cacheMiddleware(60), getRecentActivity);
router.get('/status-distribution', requireResourcePermission('analytics', 'view'), cacheMiddleware(300), getOrderStatusDistribution);
router.get('/product-performance', requireResourcePermission('analytics', 'view'), ...dateRangeValidators, cacheMiddleware(300), getProductPerformance);
router.get('/area-distribution', requireResourcePermission('analytics', 'view'), ...dateRangeValidators, cacheMiddleware(300), getAreaDistribution);

export default router;
