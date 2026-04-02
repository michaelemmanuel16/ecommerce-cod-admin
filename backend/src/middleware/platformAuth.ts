import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { tenantStorage } from '../utils/tenantContext';
import prisma from '../utils/prisma';

/**
 * Requires isPlatformAdmin flag on the user and nullifies tenant context
 * so Prisma queries return cross-tenant data.
 * This is separate from the tenant-level super_admin role.
 */
export const requirePlatformAdmin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Check the isPlatformAdmin flag from the database
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { isPlatformAdmin: true },
  });

  if (!user?.isPlatformAdmin) {
    res.status(403).json({ error: 'Forbidden: Platform admin access required' });
    return;
  }

  // Run with null tenantId so queries are cross-tenant
  tenantStorage.run({ tenantId: null }, next);
};
