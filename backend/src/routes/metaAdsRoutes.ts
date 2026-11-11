import { Router } from 'express';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { initiate, pickList, pickSave, list, toggle, remove } from '../controllers/metaAdsController';

const router = Router();

// The OAuth callback is registered in server.ts (unauthenticated; the CSRF state validates it)
const canView = requireResourcePermission('marketing', 'view');
const canUpdate = requireResourcePermission('marketing', 'update');

router.post('/oauth/initiate', authenticate, canUpdate, initiate);
router.get('/oauth/pick/:pickId', authenticate, canUpdate, pickList);
router.post('/oauth/pick/:pickId', authenticate, canUpdate, pickSave);
router.get('/accounts', authenticate, canView, list);
router.patch('/accounts/:id', authenticate, canUpdate, toggle);
router.delete('/accounts/:id', authenticate, canUpdate, remove);

export default router;
