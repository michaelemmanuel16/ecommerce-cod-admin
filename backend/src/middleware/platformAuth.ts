import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { tenantStorage } from '../utils/tenantContext';

/**
 * Requires super_admin role and nullifies tenant context
 * so Prisma queries return cross-tenant data.
 */
export const requirePlatformAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.user.role !== 'super_admin') {
    res.status(403).json({ error: 'Forbidden: Platform admin access required' });
    return;
  }

  // Run with null tenantId so queries are cross-tenant
  tenantStorage.run({ tenantId: null }, next);
};
