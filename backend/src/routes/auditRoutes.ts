import { Router } from 'express';
import { authenticate, requireResourcePermission } from '../middleware/auth';
import { listAuditLog } from '../controllers/auditController';

const router = Router();

router.use(authenticate);

// Audit rows are append-only: read here, written only by auditService.record.
router.get('/', requireResourcePermission('audit', 'view'), listAuditLog);

// Any other method (PUT, PATCH, DELETE, POST) is refused, with a login check first.
router.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.set('Allow', 'GET').status(405).json({ error: 'Audit rows cannot be changed or deleted' });
});

export default router;
