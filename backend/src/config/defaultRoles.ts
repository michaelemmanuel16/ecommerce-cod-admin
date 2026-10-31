import { UserRole } from '@prisma/client';
import { ALL_TOOL_NAMES, ToolName } from './toolPermissions';
import { switchesOn } from './roleToolRules';
import { PermissionGrid, mergeRolePermissions } from './defaultRolePermissions';

/** M2-T02: the roles every tenant starts with. M6 extends the shape (F-1150). */
export interface DefaultRole {
  name: string;
  area: string;
  contract: { purpose: string };
  /** Only the system role keeps a fixed list (registry tool names). Every other role's switches come from its grid. */
  tools?: ToolName[];
  isSystem: boolean;
  /** M6 (F-1155): the UserRole this role is the position role of (its base preset); none on a role that maps to no UserRole. */
  presetRole?: UserRole;
  /** A fixed permission grid. Roles mapped from a UserRole leave it out: their grid is the tenant's saved matrix for that UserRole. */
  permissions?: PermissionGrid;
}

/** The tool names in a role's `tools` JSON column; anything that is not a list reads as no tools. */
export function roleToolList(tools: unknown): string[] {
  return Array.isArray(tools) ? (tools as string[]) : [];
}

export const LEGACY_MCP_ROLE_NAME = 'Legacy MCP (14 tools)';

/** Tools added after the 14 that old MCP keys were issued with. The Legacy role never gets them: an old key must not gain a tool that moves money. */
const ADDED_AFTER_LEGACY: readonly ToolName[] = ['partner_payout_record'];

export const DEFAULT_ROLES: DefaultRole[] = [
  {
    name: 'Owner', presetRole: 'super_admin', area: 'Management', isSystem: false,
    contract: { purpose: 'Runs the business and sees everything.' },
  },
  {
    name: 'Call rep', presetRole: 'sales_rep', area: 'Sales', isSystem: false,
    contract: { purpose: 'Calls new customers and confirms their orders.' },
  },
  {
    name: 'Delivery', presetRole: 'delivery_agent', area: 'Delivery', isSystem: false,
    contract: { purpose: 'Delivers orders and collects the cash.' },
  },
  {
    name: 'Finance clerk', presetRole: 'accountant', area: 'Finance', isSystem: false,
    contract: { purpose: 'Keeps the books and checks cash from deliveries.' },
  },
  {
    // No UserRole value: its holders keep base role `manager` (PRD F-1155).
    name: 'Marketing', presetRole: 'manager', area: 'Marketing', isSystem: false,
    permissions: { orders: ['view'], customers: ['view'], analytics: ['view', 'export'], marketing: ['view', 'update'] },
    contract: { purpose: 'Runs ads and reads what they bring in.' },
  },
  {
    name: 'Stock keeper', presetRole: 'inventory_manager', area: 'Stock', isSystem: false,
    contract: { purpose: 'Counts stock and prepares orders for dispatch.' },
  },
  { name: 'Admin', presetRole: 'admin', area: 'Management', isSystem: false, contract: { purpose: 'Runs the daily work of the business.' } },
  { name: 'Manager', presetRole: 'manager', area: 'Management', isSystem: false, contract: { purpose: 'Leads the team and reads the numbers.' } },
  {
    name: LEGACY_MCP_ROLE_NAME, area: 'Integrations', isSystem: true, tools: ALL_TOOL_NAMES.filter((t) => !ADDED_AFTER_LEGACY.includes(t)),
    contract: { purpose: 'Old MCP keys keep working with all 14 tools until the owner tightens them.' },
  },
];

/** M6-T02 (F-1155): the position role each UserRole becomes. Marketing also has base role `manager` but is not the role mapped from it. */
export const ROLE_NAME_BY_USER_ROLE = Object.fromEntries(
  DEFAULT_ROLES.filter((r) => r.presetRole && r.name !== 'Marketing').map((r) => [r.presetRole, r.name]),
) as Record<UserRole, string>;

/** The Owner role is the one built from `super_admin`. It can never be deleted (F-1150). */
export const isOwnerRole = (role: { presetRole: UserRole | null }): boolean => role.presetRole === 'super_admin';

/**
 * The rows of DEFAULT_ROLES for one tenant, without the tenant id. A role mapped from a UserRole gets the grid that UserRole
 * has now in the tenant's saved matrix (`stored` = SystemConfig.rolePermissions), so an edited matrix is copied, never reset.
 */
export function defaultRoleRows(stored: unknown) {
  const grids = mergeRolePermissions(stored);
  return DEFAULT_ROLES.map((r) => {
    const permissions = r.permissions ?? (r.presetRole ? grids[r.presetRole] : undefined);
    // The switches that are on follow the grid (M6-T04); the system role keeps its list of registry tool names.
    return { ...r, kpis: [], permissions, tools: r.tools ?? switchesOn(permissions ?? {}) };
  });
}
