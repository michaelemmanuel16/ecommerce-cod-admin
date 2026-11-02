import { Router } from 'express';
import { authenticate, requireResourcePermission, requireRole } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import * as targetController from '../controllers/targetController';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);

// M6-T08 (F-1100 to F-1103, F-1111 to F-1113). No `targets` resource exists in the permission registry (lane A owns it), so:
//  - reading (tree, pool, daily, drivers, calculators): Owner, Admin and Manager (the roles that see Targets in the menu) with
//    `analytics:view`, the pair the owner dashboard uses; a sales rep sees their own target in their app, not here;
//  - the North Star, its quarters and months, and the driver targets are the Owner's: `settings:update`;
//  - one role, person or daily target is set by the Owner or an Admin: `users:update`, the cell the role routes use.
const canRead = [requireRole('super_admin', 'admin', 'manager'), requireResourcePermission('analytics', 'view')];
const ownerSets = requireResourcePermission('settings', 'update');
const adminSets = requireResourcePermission('users', 'update');

router.get('/tree', ...canRead, targetController.tree);
router.get('/roles/:roleId/pool', ...canRead, targetController.pool);
router.get('/daily', ...canRead, targetController.daily);
router.get('/drivers', ...canRead, targetController.drivers);
router.get('/north-star/preview', ...canRead, targetController.preview);
router.get('/calculators', ...canRead, targetController.calculators);

router.post('/north-star', ownerSets, targetController.saveNorthStar);
router.put('/drivers', ownerSets, targetController.saveDrivers);
router.put('/:id/children', ownerSets, targetController.children);
router.post('/', adminSets, targetController.save);
router.post('/batch', adminSets, targetController.saveBatch);
router.put('/:id', adminSets, targetController.update);
router.delete('/:id', adminSets, targetController.remove);

export default router;
