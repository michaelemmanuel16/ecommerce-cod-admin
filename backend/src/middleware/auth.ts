import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { verifyAccessToken } from '../utils/jwt';
import { UserRole } from '@prisma/client';
import logger from '../utils/logger';
import { enterTenant, withoutTenant } from '../utils/tenantContext';
import { isPlatformAdmin } from '../utils/platformAdmin';
import { canSeeCost } from '../utils/costAccess';
import { getUserPermissions, hasPermission, isUserActive } from '../services/permissionService';

// The permission checks live in permissionService; the middleware keeps the names callers already import.
export { clearPermissionsCache, getEffectivePermissions, getUserPermissions, hasPermission } from '../services/permissionService';

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.info(`[AuthMiddleware] No valid Authorization header for ${req.method} ${req.path}`);
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    try {
      const decoded = verifyAccessToken(token);
      req.user = decoded;
      if (decoded.tenantId) {
        // Propagate tenantId into AsyncLocalStorage so Prisma extension can scope queries
        const tenantId = decoded.tenantId;
        enterTenant(tenantId, () => {
          isUserActive(tenantId, decoded.id).then((active) => {
            if (!active) {
              res.status(401).json({ error: 'Account is no longer active', code: 'ACCOUNT_INACTIVE' });
              return;
            }
            next();
          }).catch((err) => {
            logger.error('[AuthMiddleware] Active-user check failed:', err);
            res.status(500).json({ error: 'Internal application error' });
          });
        });
        return;
      }
      // No tenant in the JWT: only a platform admin may continue (no tenant, on purpose).
      // Everyone else gets 403 instead of an unscoped context.
      isPlatformAdmin(decoded.id).then((isAdmin) => {
        if (!isAdmin) {
          res.status(403).json({ error: 'Forbidden: account has no tenant' });
          return;
        }
        req.isPlatformAdmin = true;
        withoutTenant('platform-admin', () => next());
      }).catch((err) => {
        logger.error('[AuthMiddleware] Tenant-less user check failed:', err);
        res.status(500).json({ error: 'Internal application error' });
      });
    } catch (jwtError: any) {
      logger.info(`[AuthMiddleware] JWT Verification Failed for ${req.method} ${req.path}:`, jwtError.message);

      if (jwtError.message === 'TOKEN_FORMAT_OUTDATED') {
        res.status(401).json({
          error: 'Token format outdated. Please log in again.',
          code: 'TOKEN_FORMAT_OUTDATED'
        });
        return;
      }

      // Same status and message as before; the code lets clients tell "expired" from "bad signature"
      if (jwtError.name === 'TokenExpiredError') {
        res.status(401).json({ error: 'Invalid token', code: 'TOKEN_EXPIRED' });
        return;
      }

      res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error: any) {
    logger.error('[AuthMiddleware] Unexpected internal error:', error);
    res.status(500).json({ error: 'Internal application error' });
  }
};

/**
 * For public routes that can use a login when there is one: the same token check as `authenticate`, but a missing or
 * bad token only means no `req.user` and the request goes on. It never answers 401 and does not enter a tenant context.
 */
export const optionalAuthenticate = (req: AuthRequest, _res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      req.user = verifyAccessToken(authHeader.substring(7));
    } catch {
      // treated as not logged in
    }
  }
  next();
};

export const requireRole = (...roles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
      return;
    }

    next();
  };
};

export const requirePermission = (allowedRoles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const hasPermission = allowedRoles.includes(req.user.role);

    if (!hasPermission) {
      res.status(403).json({ error: 'Forbidden: You do not have permission to perform this action' });
      return;
    }

    next();
  };
};

/**
 * The grids of the roles the user holds now (assignments with no end date): the role's own `permissions`, else the tenant's
 * matrix for its base role. A role with neither (the Legacy MCP role) gives nothing. Empty when the user holds no role that
 * gives a grid, or the lookup cannot run (no tenant context).
 */
// Resource-action permission middleware (SystemConfig.rolePermissions). Several actions mean "any of them".
export const requireResourcePermission = (resource: string, ...actions: string[]) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        logger.info(`[AuthMiddleware] requireResourcePermission(${resource}, ${actions.join('|')}) failed: req.user is missing for ${req.method} ${req.path}`);
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      for (const action of actions) {
        if (await hasPermission(req.user, resource, action)) {
          // Individual ownership checks are handled at the service/controller layer
          // for efficiency to avoid double-querying.
          next();
          return;
        }
      }

      const action = actions.join(' or ');
      logger.info(`[AuthMiddleware] User ${req.user.id} (${req.user.role}) lacks ${action} on ${resource}`);
      res.status(403).json({
        error: `Forbidden: Cannot ${action} ${resource}`,
        code: 'INSUFFICIENT_PERMISSION',
        required: { resource, action },
        userRole: req.user.role
      });
    } catch (error) {
      logger.error('Error checking permissions:', error);
      res.status(500).json({ error: 'Failed to check permissions' });
    }
  };
};

// Stock reads (inventory, shipments): products:view, but never for a call rep or a delivery agent. They get no cost and no per-holder stock (F-600).
const canViewProducts = requireResourcePermission('products', 'view');
export const requireStockView = (req: AuthRequest, res: Response, next: NextFunction) =>
  canViewProducts(req, res, (err?: unknown) => {
    if (err) return next(err);
    return canSeeCost(req.user?.role) ? next() : res.status(403).json({ error: 'You do not have access to stock figures' });
  });

/**
 * Middleware to restrict access to the resource owner or an admin.
 * Use this only for routes where ownership can be determined easily (e.g., self-profile).
 */
export const requireSelf = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const { id } = req.params;
  const userId = parseInt(id, 10);

  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.user.role === 'super_admin' || req.user.role === 'admin') {
    next();
    return;
  }

  if (req.user.id !== userId) {
    res.status(403).json({ error: 'Forbidden: You can only access your own profile' });
    return;
  }

  next();
};

// Resource-action permission middleware that checks if user has ANY of the specified permissions
export const requireEitherPermission = (checks: Array<{ resource: string, action: string }>) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Super admin always has all permissions
      if (req.user.role === 'super_admin') {
        next();
        return;
      }

      // The union of the roles the user holds (or their base role's matrix)
      const rolePermissions = await getUserPermissions(req.user);

      if (Object.keys(rolePermissions).length === 0) {
        res.status(403).json({
          error: 'Forbidden: No permissions configured for your role',
          code: 'NO_ROLE_PERMISSIONS'
        });
        return;
      }

      // Check if user has ANY of the specified permissions
      const hasAnyPermission = checks.some(check => {
        const resourcePermissions = rolePermissions[check.resource];
        return resourcePermissions && Array.isArray(resourcePermissions) && resourcePermissions.includes(check.action);
      });

      if (!hasAnyPermission) {
        res.status(403).json({
          error: `Forbidden: Requires one of: ${checks.map(c => `${c.action} ${c.resource}`).join(', ')}`,
          code: 'INSUFFICIENT_PERMISSION',
          required: checks,
          userRole: req.user.role
        });
        return;
      }

      // User has at least one of the required permissions
      next();
    } catch (error) {
      logger.error('Error checking permissions:', error);
      res.status(500).json({ error: 'Failed to check permissions' });
    }
  };
};

export const requireSuperAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.user.role !== 'super_admin') {
    res.status(403).json({ error: 'Forbidden: Super Admin access required' });
    return;
  }

  next();
};
