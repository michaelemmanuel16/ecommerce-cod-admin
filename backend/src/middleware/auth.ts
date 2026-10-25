import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { verifyAccessToken } from '../utils/jwt';
import { UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { enterTenant, getTenantId, withoutTenant } from '../utils/tenantContext';
import { isPlatformAdmin } from '../utils/platformAdmin';
import { canSeeCost } from '../utils/costAccess';

// Per-tenant cache for role permissions to avoid database hits on every request.
// Keyed by tenantId to prevent cross-tenant permission leakage.
const permissionsCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 60000; // 1 minute

async function getPermissionsFromDatabase() {
  const now = Date.now();
  const tenantId = getTenantId() || '__global__';

  const cached = permissionsCache.get(tenantId);
  if (cached && (now - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }

  let permissions: any;
  try {
    // The tenant's own row only (SystemConfig.tenantId is unique). No tenant reads the tenantId-null row.
    const config = await prisma.systemConfig.findFirst({ where: { tenantId: getTenantId() ?? null } });

    if (!config || !config.rolePermissions) {
      logger.info('[auth.getPermissionsFromDatabase] No config or rolePermissions found, using defaults');
      permissions = getDefaultPermissions();
    } else {
      logger.info('[auth.getPermissionsFromDatabase] Loaded permissions from database, merging with defaults');
      // Merge stored permissions with defaults so new resources (e.g. calls, gl)
      // are available even if the tenant saved permissions before those resources existed.
      const defaults = getDefaultPermissions();
      const stored = config.rolePermissions as Record<string, Record<string, string[]>>;
      permissions = {} as any;
      for (const role of Object.keys(defaults) as Array<keyof typeof defaults>) {
        permissions[role] = { ...defaults[role], ...(stored[role] || {}) };
      }
    }
  } catch (error) {
    logger.error('[auth.getPermissionsFromDatabase] Error fetching from database, using defaults:', error);
    permissions = getDefaultPermissions();
  }

  permissionsCache.set(tenantId, { data: permissions, timestamp: now });

  // Evict stale entries to prevent unbounded growth
  if (permissionsCache.size > 100) {
    for (const [key, entry] of permissionsCache) {
      if (now - entry.timestamp > CACHE_TTL) permissionsCache.delete(key);
    }
  }

  return permissions;
}

function getDefaultPermissions() {
  return {
    super_admin: {
      users: ['create', 'view', 'update', 'delete'],
      orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign', 'force_status'],
      customers: ['create', 'view', 'update', 'delete', 'export'],
      products: ['create', 'view', 'update', 'delete', 'update_stock'],
      financial: ['view', 'create', 'update', 'delete'],
      analytics: ['view', 'export'],
      marketing: ['view'],
      workflows: ['create', 'view', 'update', 'delete', 'execute'],
      settings: ['view', 'update'],
      calls: ['create', 'view', 'update', 'delete'],
      gl: ['create', 'view', 'update', 'delete'],
      audit: ['view'],
    },
    admin: {
      users: ['create', 'view', 'update', 'delete'],
      orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign', 'update_status'],
      customers: ['create', 'view', 'update', 'delete', 'export'],
      products: ['create', 'view', 'update', 'delete', 'update_stock'],
      financial: ['view', 'create'],
      analytics: ['view', 'export'],
      marketing: ['view'],
      workflows: ['create', 'view', 'update', 'delete', 'execute'],
      settings: ['view'],
      calls: ['create', 'view', 'update', 'delete'],
      gl: ['create', 'view', 'update', 'delete'],
      audit: ['view'],
    },
    manager: {
      users: [],
      orders: ['view', 'update', 'bulk_import', 'assign'],
      customers: ['create', 'view', 'update', 'delete', 'export'],
      products: ['view'],
      financial: ['view'],
      analytics: ['view', 'export'],
      marketing: ['view'],
      workflows: ['view', 'execute'],
      settings: [],
      calls: ['view'],
      gl: ['view'],
    },
    sales_rep: {
      users: [],
      orders: ['create', 'view', 'update'],
      customers: ['create', 'view', 'update'],
      products: ['view'],
      financial: [],
      analytics: ['view'],
      marketing: [],
      workflows: [],
      settings: [],
      calls: ['create', 'view'],
      gl: [],
    },
    inventory_manager: {
      users: [],
      orders: ['view', 'update_status'],
      customers: ['view'],
      products: ['create', 'view', 'update', 'delete', 'update_stock'],
      financial: [],
      analytics: ['view'],
      marketing: [],
      workflows: [],
      settings: [],
      calls: [],
      gl: [],
    },
    delivery_agent: {
      users: [],
      orders: ['view', 'update'],
      customers: ['view'],
      products: ['view'],
      financial: ['create'],
      analytics: ['view'],
      marketing: [],
      workflows: [],
      settings: [],
      calls: ['view'],
      gl: [],
    },
    accountant: {
      users: [],
      orders: ['view'],
      customers: ['view'],
      products: ['view'],
      financial: ['view', 'create'],
      analytics: ['view', 'export'],
      marketing: [],
      workflows: [],
      calls: [],
      settings: [],
      gl: ['create', 'view', 'update'],
    },
  };
}

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
        enterTenant(decoded.tenantId, next);
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
 * Permission check used by requireResourcePermission and the services:
 * super_admin always passes, other roles need the action in their (merged) role permissions.
 */
export async function hasPermission(
  user: { id?: number; role: UserRole | string },
  resource: string,
  action: string
): Promise<boolean> {
  if (user.role === 'super_admin') return true;
  const permissions = await getPermissionsFromDatabase();
  const list = permissions[user.role]?.[resource];
  return Array.isArray(list) && list.includes(action);
}

/** The role's permissions as the checks above see them: the tenant's saved matrix merged over the defaults. */
export async function getEffectivePermissions(role: UserRole | string): Promise<Record<string, string[]>> {
  const permissions = await getPermissionsFromDatabase();
  return permissions[role] ?? {};
}

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

      // Get permissions from database (or cache)
      const permissions = await getPermissionsFromDatabase();
      const rolePermissions = permissions[req.user.role];

      if (!rolePermissions) {
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

// Helper to clear permissions cache (call after updating permissions)
export const clearPermissionsCache = (): void => {
  permissionsCache.clear();
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
