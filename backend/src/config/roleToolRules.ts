import { UserRole } from '@prisma/client';
import { ALL_TOOL_NAMES, TOOL_PERMISSIONS } from './toolPermissions';
import { PermissionGrid, defaultRolePermissions } from './defaultRolePermissions';

/**
 * M6-T04 (F-1153): the 16 tool switches of a role. `Role.tools` stores the keys of the switches that are on. Each switch is a
 * preset of matrix cells ("resource:action"): on means all its cells are granted. A write switch needs the read switch named in
 * `requires`. This is the one table; the count, the dependency rule and the cell sync all read it.
 *
 * Deviation from the PRD text: "Update order status" grants `orders:update` (PRD) and `orders:update_status` (the cell the
 * registry tool `orders_update_status` and the status endpoints check), so a role with the switch can use both.
 */
export interface RoleTool { key: string; label: string; kind: 'read' | 'write'; cells: readonly string[]; requires?: string }

export const ROLE_TOOLS: readonly RoleTool[] = [
  { key: 'view_orders', label: 'View orders', kind: 'read', cells: ['orders:view'] },
  { key: 'view_customers', label: 'View customers', kind: 'read', cells: ['customers:view'] },
  { key: 'view_stock', label: 'View stock', kind: 'read', cells: ['products:view'] },
  { key: 'view_payouts', label: 'View payouts', kind: 'read', cells: ['payouts:view'] },
  { key: 'view_reports', label: 'View reports', kind: 'read', cells: ['analytics:view'] },
  { key: 'view_targets', label: 'View targets', kind: 'read', cells: ['targets:view'] },
  { key: 'export_data', label: 'Export data', kind: 'read', cells: ['analytics:export'] },
  { key: 'update_order_status', label: 'Update order status', kind: 'write', cells: ['orders:update', 'orders:update_status'], requires: 'view_orders' },
  { key: 'assign_orders', label: 'Assign orders', kind: 'write', cells: ['orders:assign'], requires: 'view_orders' },
  { key: 'call_customers', label: 'Call customers', kind: 'write', cells: ['calls:create'], requires: 'view_customers' },
  { key: 'message_customers', label: 'Message customers', kind: 'write', cells: ['messages:create'], requires: 'view_customers' },
  { key: 'edit_products', label: 'Edit products', kind: 'write', cells: ['products:create', 'products:update'], requires: 'view_stock' },
  { key: 'adjust_stock', label: 'Adjust stock', kind: 'write', cells: ['products:update_stock'], requires: 'view_stock' },
  { key: 'record_payout', label: 'Record payout', kind: 'write', cells: ['payouts:create'], requires: 'view_payouts' },
  { key: 'edit_targets', label: 'Edit targets', kind: 'write', cells: ['targets:update'], requires: 'view_targets' },
  // No read switch for the team list: the cells users:create and users:update stand alone.
  { key: 'manage_team', label: 'Manage team', kind: 'write', cells: ['users:create', 'users:update'] },
];

export const ROLE_TOOL_TOTAL = ROLE_TOOLS.length;

const BY_KEY = new Map(ROLE_TOOLS.map((t) => [t.key, t]));
export const isRoleTool = (key: string): boolean => BY_KEY.has(key);

const grants = (grid: PermissionGrid, cell: string): boolean => {
  const [resource, action] = cell.split(':');
  return (grid[resource] ?? []).includes(action);
};

/** The names of the read switches a set of switches lacks ("View orders"), in table order. */
export function missingReadTools(keys: readonly string[]): string[] {
  const on = new Set(keys);
  const missing = new Set<string>();
  for (const key of keys) {
    const need = BY_KEY.get(key)?.requires;
    if (need && !on.has(need)) missing.add(BY_KEY.get(need)!.label);
  }
  return [...missing];
}

/** The switches a grid turns on: those whose cells are all granted. */
export const switchesOn = (grid: PermissionGrid): string[] =>
  ROLE_TOOLS.filter((t) => t.cells.every((c) => grants(grid, c))).map((t) => t.key);

/**
 * The grid after the switches become `keys`. A switch that was on and is now off loses its cells, except a cell another switch
 * that stays on needs; a switch that is on gets all its cells. Cells no switch owns are not touched.
 */
export function applySwitches(grid: PermissionGrid, keys: readonly string[]): PermissionGrid {
  const next: PermissionGrid = Object.fromEntries(Object.entries(grid).map(([r, a]) => [r, [...a]]));
  const wanted = new Set(keys);
  const needed = new Set(ROLE_TOOLS.filter((t) => wanted.has(t.key)).flatMap((t) => t.cells));
  const wasOn = new Set(switchesOn(grid));
  for (const tool of ROLE_TOOLS) {
    if (!wasOn.has(tool.key) || wanted.has(tool.key)) continue;
    for (const cell of tool.cells) {
      if (needed.has(cell)) continue;
      const [resource, action] = cell.split(':');
      next[resource] = (next[resource] ?? []).filter((a) => a !== action);
    }
  }
  for (const cell of needed) {
    const [resource, action] = cell.split(':');
    next[resource] ??= [];
    if (!next[resource].includes(action)) next[resource].push(action);
  }
  return next;
}

/** The grid a set of switches gives on its own. */
export const gridFromSwitches = (keys: readonly string[]): PermissionGrid => applySwitches({}, keys);

const normal = (g: PermissionGrid) =>
  JSON.stringify(Object.entries(g).filter(([, a]) => a.length).map(([r, a]) => [r, [...a].sort()]).sort((x, y) => String(x[0]).localeCompare(String(y[0]))));

export const sameGrid = (a: PermissionGrid, b: PermissionGrid): boolean => normal(a) === normal(b);

type GridSource = { permissions: unknown; presetRole: UserRole | null };

const isGrid = (v: unknown): v is PermissionGrid => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The grid a role gives its holders: its own `permissions`, else the base-role matrix (`matrix`, the defaults unless the caller
 * has the tenant's), else nothing. One rule for the middleware, the role views and the MCP keys.
 */
export function gridOfRole(role: GridSource, matrix: Record<string, PermissionGrid> = defaultRolePermissions()): PermissionGrid {
  if (isGrid(role.permissions)) return role.permissions;
  return role.presetRole ? matrix[role.presetRole] ?? {} : {};
}

export const hasOwnGrid = (role: { permissions: unknown }): boolean => isGrid(role.permissions);

/** The registry tools (MCP) a grid allows: those whose cell in TOOL_PERMISSIONS the grid grants. */
export const registryToolsForGrid = (grid: PermissionGrid): string[] =>
  ALL_TOOL_NAMES.filter((t) => grants(grid, TOOL_PERMISSIONS[t]));

/**
 * The registry tools an MCP key of this role may call (F-1153). A system role (Legacy MCP) keeps its stored list of registry
 * names; every other role gets the tools its grid allows.
 */
export function registryToolsOfRole(role: GridSource & { isSystem: boolean; tools: unknown }): string[] {
  if (role.isSystem) return (Array.isArray(role.tools) ? role.tools : []).filter((t): t is string => typeof t === 'string' && t in TOOL_PERMISSIONS);
  return registryToolsForGrid(gridOfRole(role));
}
