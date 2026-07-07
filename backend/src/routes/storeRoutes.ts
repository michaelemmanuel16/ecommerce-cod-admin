import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { getStores, switchStore } from '../controllers/storeController';

const router = Router();

// Authenticated but NOT requireResolvedTenant: an owner with a null/pending
// active store must still list and switch stores. These endpoints touch only
// StoreMembership (not tenant-scoped), never tenant-scoped data.
router.use(authenticate);

router.get('/', getStores);
router.post('/switch', switchStore);

export default router;
