import { Router, Request, Response } from 'express';
import prisma from '../utils/prisma';
import { authenticate, requireSuperAdmin } from '../middleware/auth';
import { tenantRateLimiter } from '../middleware/tenantRateLimiter';
import { roleToolList } from '../config/defaultRoles';

const router = Router();

router.use(authenticate);
router.use(tenantRateLimiter);
router.use(requireSuperAdmin);

// The tenant's roles with their tool counts (read-only; roles are managed in M6).
router.get('/', async (_req: Request, res: Response) => {
  try {
    const roles = await prisma.role.findMany({
      select: { id: true, name: true, area: true, isSystem: true, tools: true },
      orderBy: { name: 'asc' },
    });
    res.json({
      roles: roles.map(({ tools, ...role }) => ({
        ...role,
        toolCount: roleToolList(tools).length,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
});

export default router;
