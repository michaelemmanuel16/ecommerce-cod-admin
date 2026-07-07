import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { getStores, createStore, switchStore, deleteStore } from '../controllers/storeController';

const router = Router();

// Authenticated but NOT requireResolvedTenant: an owner with a null/pending
// active store must still list and switch stores. These endpoints touch only
// StoreMembership (not tenant-scoped), never tenant-scoped data.
router.use(authenticate);

router.get('/', getStores);
// Provisioning starts a paid subscription, so it is super_admin (owner) only —
// same gate as the billing/start-subscription routes. Listing + switching stay
// open to any authenticated member.
router.post('/', requireRole('super_admin'), createStore);
router.post('/switch', switchStore);
router.delete('/:id', deleteStore);

export default router;
