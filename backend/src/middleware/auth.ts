import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { verifyAccessToken } from '../utils/jwt';
import { UserRole } from '@prisma/client';
import prisma from '../utils/prisma';

// Cache for role permissions to avoid database hits on every request
let permissionsCache: any = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60000; // 1 minute

async function getPermissionsFromDatabase() {
  const now = Date.now();

  // Return cached permissions if still valid
  if (permissionsCache && (now - cacheTimestamp) < CACHE_TTL) {
    return permissionsCache;
  }

  // Fetch fresh permissions from database
  try {
    const config = await prisma.systemConfig.findFirst();

    if (!config || !config.rolePermissions) {
      console.log('[auth.getPermissionsFromDatabase] No config or rolePermissions found, using defaults');
      permissionsCache = getDefaultPermissions();
    } else {
      console.log('[auth.getPermissionsFromDatabase] Loaded permissions from database');
      permissionsCache = config.rolePermissions as any;
    }
  } catch (error) {
    console.error('[auth.getPermissionsFromDatabase] Error fetching from database, using defaults:', error);
    permissionsCache = getDefaultPermissions();
  }

  cacheTimestamp = now;
  return permissionsCache;
}

function getDefaultPermissions() {
  return {
    super_admin: {
      users: ['create', 'view', 'update', 'delete'],
      orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign'],
      customers: ['create', 'view', 'update', 'delete'],
      products: ['create', 'view', 'update', 'delete', 'update_stock'],
      financial: ['view', 'create', 'update', 'delete'],
      analytics: ['view'],
      workflows: ['create', 'view', 'update', 'delete', 'execute'],
      settings: ['view', 'update'],
      calls: ['create', 'view', 'update', 'delete'],
      gl: ['create', 'view', 'update', 'delete'],
    },
    admin: {
      users: ['create', 'view', 'update', 'delete'],
      orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign'],
      customers: ['create', 'view', 'update', 'delete'],
      products: ['create', 'view', 'update', 'delete'],
      financial: ['view', 'create'],
      analytics: ['view'],
      workflows: ['create', 'view', 'update', 'delete', 'execute'],
      settings: ['view'],
      calls: ['create', 'view', 'update', 'delete'],
      gl: ['create', 'view', 'update', 'delete'],
    },
    manager: {
      users: [],
      orders: ['view', 'update', 'bulk_import', 'assign'],
      customers: ['create', 'view', 'update', 'delete'],
      products: ['view'],
      financial: ['view'],
      analytics: ['view'],
      workflows: ['view', 'execute'],
      settings: [],
      calls: ['view'],
      gl: ['view'],
    },
    sales_rep: {
      users: [],
      orders: ['create', 'view', 'update'],
      customers: ['create', 'view', 'update', 'delete'],
      products: ['view'],
      financial: [],
      analytics: ['view'],
      workflows: [],
      settings: [],
      calls: ['create', 'view'],
      gl: [],
    },
    inventory_manager: {
      users: [],
      orders: ['view'],
      customers: ['view'],
      products: ['create', 'view', 'update', 'delete', 'update_stock'],
      financial: [],
      analytics: ['view'],
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
      workflows: [],
      settings: [],
      calls: [],
      gl: [],
    },
    accountant: {
      users: [],
      orders: ['view'],
      customers: ['view'],
      products: ['view'],
      financial: ['view', 'create'],
      analytics: ['view'],
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
      console.log(`[AuthMiddleware] No valid Authorization header for ${req.method} ${req.path}`);
      res.status(401).json({ error: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    try {
      const decoded = verifyAccessToken(token);
      req.user = decoded;
      next();
    } catch (jwtError: any) {
      console.log('[AuthMiddleware] JWT Verification Failed for %s %s:', req.method, req.path, jwtError.message);

      if (jwtError.message === 'TOKEN_FORMAT_OUTDATED') {
        res.status(401).json({
          error: 'Token format outdated. Please log in again.',
          code: 'TOKEN_FORMAT_OUTDATED'
        });
        return;
      }

      res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error: any) {
    console.error('[AuthMiddleware] Unexpected internal error:', error);
    res.status(500).json({ error: 'Internal application error' });
  }
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

// New: Resource-action permission middleware that checks SystemConfig.rolePermissions
export const requireResourcePermission = (resource: string, action: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        console.log(`[AuthMiddleware] requireResourcePermission(${resource}, ${action}) failed: req.user is missing for ${req.method} ${req.path}`);
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Check permissions from database (or cache)
      const permissions = await getPermissionsFromDatabase();
      console.log(`[AuthMiddleware] Checking ${action} on ${resource} for user ${req.user.id} (${req.user.role})`);

      // Super admin always has all permissions
      if (req.user.role === 'super_admin') {
        next();
        return;
      }

      const rolePermissions = permissions[req.user.role];

      if (!rolePermissions) {
        console.log(`[AuthMiddleware] No permissions found for role: ${req.user.role}`);
        res.status(403).json({
          error: 'Forbidden: No permissions configured for your role',
          code: 'NO_ROLE_PERMISSIONS'
        });
        return;
      }

      const resourcePermissions = rolePermissions[resource];

      if (!resourcePermissions || !Array.isArray(resourcePermissions)) {
        console.log(`[AuthMiddleware] No resource permissions for: ${resource} for role: ${req.user.role}`);
        res.status(403).json({
          error: `Forbidden: No access to ${resource}`,
          code: 'NO_RESOURCE_ACCESS'
        });
        return;
      }

      if (!resourcePermissions.includes(action)) {
        console.log(`[AuthMiddleware] User ${req.user.id} (${req.user.role}) lacks ${action} on ${resource}`);
        res.status(403).json({
          error: `Forbidden: Cannot ${action} ${resource}`,
          code: 'INSUFFICIENT_PERMISSION',
          required: { resource, action },
          userRole: req.user.role
        });
        return;
      }

      // User has the base permission. 
      // Individual ownership checks are handled at the service/controller layer 
      // for efficiency to avoid double-querying.
      next();
    } catch (error) {
      console.error('Error checking permissions:', error);
      res.status(500).json({ error: 'Failed to check permissions' });
    }
  };
};

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
      console.error('Error checking permissions:', error);
      res.status(500).json({ error: 'Failed to check permissions' });
    }
  };
};

// Helper to clear permissions cache (call after updating permissions)
export const clearPermissionsCache = (): void => {
  permissionsCache = null;
  cacheTimestamp = 0;
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
