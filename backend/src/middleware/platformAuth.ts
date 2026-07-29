import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { tenantStorage } from '../utils/tenantContext';
import { prismaBase } from '../utils/prisma';

/**
 * Requires isPlatformAdmin flag on the user and nullifies tenant context
 * so Prisma queries return cross-tenant data.
 * This is separate from the tenant-level super_admin role.
 * Verifies isPlatformAdmin via DB lookup (not in JWT payload).
 */
export const requirePlatformAdmin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // Resolve platform-admin identity through the UNSCOPED client, BEFORE nullifying
  // tenant context. An owner in platform mode legitimately holds a null (or other
  // store's) active tenant; the extended client would inject that tenant into this
  // lookup (User is tenant-scoped) and fail to find the owner — a 403 lockout that
  // also traps brand-new zero-store owners out of the provisioning console. This is
  // the zero-store bootstrap: platform-admin auth needs no resolved store.
  const user = await prismaBase.user.findFirst({
    where: { id: req.user.id, isActive: true },
    select: { isPlatformAdmin: true },
  });

  if (!user?.isPlatformAdmin) {
    res.status(403).json({ error: 'Forbidden: Platform admin access required' });
    return;
  }

  // Run with null tenantId so queries are cross-tenant
  tenantStorage.run({ tenantId: null }, next);
};
