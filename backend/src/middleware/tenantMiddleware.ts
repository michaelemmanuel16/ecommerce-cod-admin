import type { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { tenantStorage } from '../utils/tenantContext';

/**
 * Sets tenantId from the authenticated user's JWT claim into AsyncLocalStorage.
 * Must be applied after the `authenticate` middleware.
 * Prisma's tenantIsolationExtension reads from this context to auto-inject tenantId.
 */
export const setTenantContext = (req: AuthRequest, _res: Response, next: NextFunction): void => {
  const tenantId = req.user?.tenantId ?? null;
  tenantStorage.run({ tenantId }, next);
};
