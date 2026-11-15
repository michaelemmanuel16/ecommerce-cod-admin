import { Router } from 'express';
import * as controller from '../controllers/threadController';
import { authenticate } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';

// M9-T19: threads by subject. Who may open one is decided in the service from the subject's own access rule.
const router = Router();
router.use(authenticate);
router.use(tenantRateLimiter);
router.get('/by-subject/:type/:id', controller.getBySubject);
router.get('/by-subject/:type/:id/mentionable', controller.getMentionable);
router.post('/by-subject/:type/:id/comments', controller.addComment);

export const commentRoutes = Router();
commentRoutes.use(authenticate);
commentRoutes.use(tenantRateLimiter);
commentRoutes.patch('/:id', controller.editComment);
commentRoutes.delete('/:id', controller.deleteComment);

export default router;
