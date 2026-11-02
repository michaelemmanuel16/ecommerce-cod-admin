import { UserRole } from '@prisma/client';

/** resource -> actions */
export type PermissionGrid = Record<string, string[]>;

/**
 * The default role-permission matrix (SystemConfig.rolePermissions before a tenant saves its own): resource -> actions per role.
 * One copy, read by the auth middleware (the effective permissions) and by `adminService.getDefaultPermissions` (what Settings
 * shows and edits), so a resource added here appears in both. A fresh object on every call.
 */
export function defaultRolePermissions() {
  return {
    super_admin: {
      users: ['create', 'view', 'update', 'delete'],
      orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign', 'force_status', 'update_status'],
      customers: ['create', 'view', 'update', 'delete', 'export'],
      products: ['create', 'view', 'update', 'delete', 'update_stock'],
      financial: ['view', 'create', 'update', 'delete'],
      analytics: ['view', 'export'],
      marketing: ['view', 'update'],
      workflows: ['create', 'view', 'update', 'delete', 'execute'],
      settings: ['view', 'update'],
      calls: ['create', 'view', 'update', 'delete'],
      gl: ['create', 'view', 'update', 'delete'],
      payouts: ['view', 'create'],
      journal: ['post', 'void'],
      expenses: ['view_all', 'edit', 'delete'],
      audit: ['view'],
      targets: ['view', 'update'],
      messages: ['view', 'create'],
    },
    admin: {
      users: ['create', 'view', 'update', 'delete'],
      orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign', 'update_status'],
      customers: ['create', 'view', 'update', 'delete', 'export'],
      products: ['create', 'view', 'update', 'delete', 'update_stock'],
      financial: ['view', 'create'],
      analytics: ['view', 'export'],
      marketing: ['view', 'update'],
      workflows: ['create', 'view', 'update', 'delete', 'execute'],
      settings: ['view'],
      calls: ['create', 'view', 'update', 'delete'],
      gl: ['create', 'view', 'update', 'delete'],
      payouts: ['view', 'create'],
      expenses: ['view_all', 'edit', 'delete'],
      audit: ['view'],
      targets: ['view', 'update'],
      messages: ['view', 'create'],
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
      payouts: ['view', 'create'],
      expenses: ['view_all'],
      targets: ['view'],
      messages: ['view'],
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
      payouts: [],
      targets: ['view'],
      messages: ['view', 'create'],
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
      payouts: [],
      targets: ['view'],
      messages: ['view'],
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
      payouts: [],
      targets: ['view'],
      messages: ['view'],
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
      payouts: ['view', 'create'],
      journal: ['post', 'void'],
      expenses: ['view_all', 'edit', 'delete'],
      targets: ['view'],
      messages: ['view'],
    },
  };
}

/**
 * What each UserRole may do: the tenant's saved matrix laid over the defaults, resource by resource (a saved list replaces the
 * default list). Read by the auth middleware and by the role seed, so both apply one rule.
 */
export function mergeRolePermissions(stored: unknown): Record<UserRole, PermissionGrid> {
  const defaults = defaultRolePermissions() as Record<UserRole, PermissionGrid>;
  const saved = (stored ?? {}) as Partial<Record<UserRole, PermissionGrid>>;
  const merged = {} as Record<UserRole, PermissionGrid>;
  for (const role of Object.keys(defaults) as UserRole[]) merged[role] = { ...defaults[role], ...(saved[role] || {}) };
  return merged;
}

/**
 * Union of permission grids: a resource keeps every action any grid gives it (F-1155). Used for a person who holds several
 * roles, and for the "last holder" check.
 */
export function unionPermissions(grids: Array<PermissionGrid | null | undefined>): PermissionGrid {
  const union: Record<string, Set<string>> = {};
  for (const grid of grids) {
    for (const [resource, actions] of Object.entries(grid ?? {})) {
      union[resource] ??= new Set();
      for (const a of actions) union[resource].add(a);
    }
  }
  return Object.fromEntries(Object.entries(union).map(([r, s]) => [r, [...s]]));
}

/**
 * M6-T04 (F-1154): every cell the matrix may hold, resource -> actions. A role grid is checked against it, so a typo cannot
 * be saved as a permission. Includes the cells the old matrix has plus the resources F-1153 adds (targets, messages,
 * marketing update, payouts).
 */
export const PERMISSION_CATALOG: Readonly<Record<string, readonly string[]>> = {
  users: ['create', 'view', 'update', 'delete'],
  orders: ['create', 'view', 'update', 'delete', 'bulk_import', 'assign', 'force_status', 'update_status'],
  customers: ['create', 'view', 'update', 'delete', 'export'],
  products: ['create', 'view', 'update', 'delete', 'update_stock'],
  financial: ['view', 'create', 'update', 'delete'],
  analytics: ['view', 'export'],
  marketing: ['view', 'update'],
  workflows: ['create', 'view', 'update', 'delete', 'execute'],
  settings: ['view', 'update'],
  calls: ['create', 'view', 'update', 'delete'],
  gl: ['create', 'view', 'update', 'delete'],
  payouts: ['view', 'create'],
  journal: ['post', 'void'],
  expenses: ['view_all', 'edit', 'delete'],
  audit: ['view'],
  targets: ['view', 'update'],
  messages: ['view', 'create'],
};
