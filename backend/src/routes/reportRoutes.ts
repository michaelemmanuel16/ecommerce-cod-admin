import { Router } from 'express';
import { exportReport, getReport, getTeamReport, tabNotBuilt } from '../controllers/reportController';
import { authenticate, requirePermission, requireResourcePermission } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { bulkOrderRateLimiter } from '../middleware/bulkRateLimiter';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// F-1050: Owner, Admin, Manager and the Finance clerk use Reports. Call reps, agents and the stock manager have no Reports
// whatever their analytics:view, because these tabs are tenant-wide.
const reportRoles = requirePermission(['super_admin', 'admin', 'manager', 'accountant']);

// M3-T20, M3-T21: GET /api/reports/:tab?from&to&compare=previous. Cash tiles of Sales need financial:view (checked in the controller).
router.get('/overview', reportRoles, requireResourcePermission('analytics', 'view'), getReport('overview'));
router.get('/sales', reportRoles, requireResourcePermission('analytics', 'view'), getReport('sales'));
router.get('/delivery', reportRoles, requireResourcePermission('analytics', 'view'), getReport('delivery'));

// F-1054: the team table lists every rep, so it is limited to owner, admin and manager. A sales rep reads their own
// numbers from GET /api/users/reps/performance, which the controller scopes to their id.
router.get('/team', requireResourcePermission('analytics', 'view'), requirePermission(['super_admin', 'admin', 'manager']), getTeamReport);

// Products (M5) and Marketing (M8) are not built: the permission still answers first (F-1050).
router.get('/products', reportRoles, requireResourcePermission('financial', 'view'), tabNotBuilt);
router.get('/marketing', reportRoles, requireResourcePermission('marketing', 'view'), tabNotBuilt);

// F-1057: CSV or Excel of a tab, or `all` for one workbook. Permission is checked per tab in the controller.
router.get('/:tab/export', bulkOrderRateLimiter, exportReport);

export default router;
