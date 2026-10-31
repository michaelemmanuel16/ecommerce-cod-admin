import { UserRole } from '@prisma/client';
import { defaultRolePermissions } from './defaultRolePermissions';
import type { DefaultRole } from './defaultRoles';

/** M6-T02 (F-1155): the position role each UserRole becomes. The enum stays as the base preset (`canManageRole`). */
export const ROLE_NAME_BY_USER_ROLE: Record<UserRole, string> = {
  super_admin: 'Owner',
  sales_rep: 'Call rep',
  delivery_agent: 'Delivery',
  accountant: 'Finance clerk',
  inventory_manager: 'Stock keeper',
  admin: 'Admin',
  manager: 'Manager',
};

/** Position roles that have no entry in DEFAULT_ROLES (M2). No tools: the 16 tool switches are built in M6-T04. */
export const POSITION_ROLES: DefaultRole[] = [
  { name: 'Admin', area: 'Management', isSystem: false, tools: [], contract: { purpose: 'Runs the daily work of the business.' } },
  { name: 'Manager', area: 'Management', isSystem: false, tools: [], contract: { purpose: 'Leads the team and reads the numbers.' } },
];

/** Marketing has no UserRole value (PRD F-1155): its holders keep base role `manager`. Reads orders, customers and reports; reads and edits marketing. */
export const MARKETING_ROLE_NAME = 'Marketing';
export const MARKETING_PRESET: UserRole = 'manager';
export const MARKETING_PERMISSIONS: Record<string, string[]> = {
  users: [],
  orders: ['view'],
  customers: ['view'],
  products: [],
  financial: [],
  analytics: ['view', 'export'],
  marketing: ['view', 'update'],
  workflows: [],
  settings: [],
  calls: [],
  gl: [],
  payouts: [],
};

export type PermissionGrid = Record<string, string[]>;

/**
 * The grid each UserRole has today: the tenant's saved matrix laid over the defaults, resource by resource.
 * The same rule as `getPermissionsFromDatabase` in the auth middleware (stored resources replace the default list).
 */
export function currentGridByUserRole(stored: unknown): Record<UserRole, PermissionGrid> {
  const defaults = defaultRolePermissions() as Record<UserRole, PermissionGrid>;
  const saved = (stored ?? {}) as Partial<Record<UserRole, PermissionGrid>>;
  const grids = {} as Record<UserRole, PermissionGrid>;
  for (const role of Object.keys(defaults) as UserRole[]) grids[role] = { ...defaults[role], ...(saved[role] || {}) };
  return grids;
}
