import { UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import { getTenantMatrix, getUserPermissions } from './permissionService';
import { ROLE_NAME_BY_USER_ROLE, isPositionRole } from '../config/defaultRoles';
import { gridOfRole } from '../config/roleToolRules';
import { resolveTenantId } from '../utils/tenantContext';
import { startOfUtcDay } from '../utils/startOfUtcDay';
import { orderScope, Requester } from '../utils/authUtils';

/** M3-T07: what the app shell needs per user: counts for the pills, menu keys, home route, role names (F-101, F-102, F-104). */

type Permissions = Record<string, string[]>;

/** F-102 role home. Reps and agents stay on the current pages until the rep and agent apps ship (M7, M10). */
const HOME_ROUTE: Record<UserRole, string> = {
  super_admin: '/',
  admin: '/',
  manager: '/',
  sales_rep: '/',
  delivery_agent: '/',
  accountant: '/finance',
  inventory_manager: '/inventory', // the stock keeper lives on Inventory and stock (M4-T29)
};

const OWNER_ADMIN: UserRole[] = ['super_admin', 'admin'];
const MANAGER_UP: UserRole[] = [...OWNER_ADMIN, 'manager'];
const DESK: UserRole[] = [...MANAGER_UP, 'accountant', 'inventory_manager'];

interface MenuCtx { role: UserRole; has: (resource: string, action: string) => boolean }

/** F-102 menu table, one rule per item. The rules give exactly the yes/no cells of the table for the five desk roles. */
const MENU_RULES: Array<[key: string, allowed: (c: MenuCtx) => boolean]> = [
  ['dashboard', (c) => c.has('analytics', 'view') && MANAGER_UP.includes(c.role)],
  ['inbox', () => true],
  ['orders', (c) => c.has('orders', 'view')],
  ['customers', (c) => c.has('customers', 'view')],
  ['checkoutForms', (c) => MANAGER_UP.includes(c.role)],
  ['messages', (c) => MANAGER_UP.includes(c.role)],
  // Reps and agents never saw Products in the old menu; keep that.
  ['products', (c) => c.has('products', 'view') && c.role !== 'sales_rep' && c.role !== 'delivery_agent'],
  ['inventory', (c) => MANAGER_UP.includes(c.role) || c.has('products', 'update_stock') || c.has('inventory', 'view')],
  ['deliveries', (c) => MANAGER_UP.includes(c.role)],
  ['finance', (c) => c.has('financial', 'view')],
  ['marketing', (c) => c.has('marketing', 'view')],
  ['reports', (c) => c.has('analytics', 'view') && (MANAGER_UP.includes(c.role) || c.role === 'accountant')],
  ['targets', (c) => MANAGER_UP.includes(c.role)],
  ['leaderboard', (c) => DESK.includes(c.role)],
  ['staff', (c) => c.has('users', 'view') || c.role === 'manager'], // the manager sees it read only
  ['workflows', (c) => c.has('workflows', 'view')],
  ['connections', (c) => OWNER_ADMIN.includes(c.role)],
  ['settings', () => true],
  ['setupNorthStar', (c) => c.role === 'super_admin'],
];

const hasIn = (role: UserRole, permissions: Permissions) => (resource: string, action: string) =>
  role === 'super_admin' || (permissions[resource] ?? []).includes(action);

export function menuKeys(role: UserRole, permissions: Permissions): string[] {
  const ctx = { role, has: hasIn(role, permissions) };
  return MENU_RULES.filter(([, allowed]) => allowed(ctx)).map(([key]) => key);
}

/**
 * F-1163 menu table for a custom role (M6-T21): permissions only, no base role. The seeded roles keep the F-102 rules above, so
 * the people who hold them see what they saw before; a custom role, such as a view-only one, sees exactly what its cells allow.
 * "Dashboard" and "Inbox" and "Settings" are for any signed-in user.
 */
const CELL_RULES: Array<[key: string, allowed: (has: MenuCtx['has']) => boolean]> = [
  ['dashboard', () => true],
  ['inbox', () => true],
  ['orders', (has) => has('orders', 'view')],
  ['customers', (has) => has('customers', 'view')],
  ['checkoutForms', (has) => has('products', 'update')],
  ['messages', (has) => has('messages', 'view')],
  ['products', (has) => has('products', 'view')],
  ['inventory', (has) => has('products', 'view')],
  ['deliveries', (has) => has('orders', 'assign') || has('users', 'view')],
  ['finance', (has) => has('financial', 'view')],
  ['marketing', (has) => has('marketing', 'view')],
  ['reports', (has) => has('analytics', 'view')],
  ['targets', (has) => has('targets', 'view')],
  ['leaderboard', (has) => has('targets', 'view')],
  ['staff', (has) => has('users', 'view')],
  ['workflows', (has) => has('workflows', 'view')],
  ['connections', (has) => has('settings', 'view')],
  ['settings', () => true],
];

export interface HeldRole { presetRole: UserRole | null; name: string; grid: Permissions }

/**
 * The menu of a person who holds roles (F-1163, F-1155): each role gives its own items and the person sees the union, in menu
 * order. A seeded role (Owner, Admin, Manager, Finance clerk, ...) follows the F-102 rules of its base role; any other role
 * follows the cell table. A person with no role (an old account) follows the base role and the union of permissions.
 */
export function menuKeysForRoles(role: UserRole, permissions: Permissions, held: HeldRole[]): string[] {
  if (held.length === 0) return menuKeys(role, permissions);
  const keys = new Set<string>();
  for (const r of held) {
    if (r.presetRole && isPositionRole(r)) menuKeys(r.presetRole, r.grid).forEach((k) => keys.add(k));
    else CELL_RULES.filter(([, allowed]) => allowed(hasIn(role, r.grid))).forEach(([k]) => keys.add(k));
  }
  // The Owner's North Star item is the base role's alone
  if (role === 'super_admin') keys.add('setupNorthStar');
  return MENU_RULES.map(([key]) => key).filter((key) => keys.has(key));
}

export const homeRouteFor = (role: UserRole): string => HOME_ROUTE[role];

/** Roles from RoleAssignment (running today): names for the shell, and the roles with their grids for the menu. */
async function heldRoles(userId: number) {
  const today = startOfUtcDay();
  const [assignments, matrix] = await Promise.all([
    prisma.roleAssignment.findMany({
      where: { holderId: userId, fromDate: { lte: today }, OR: [{ toDate: null }, { toDate: { gte: today } }] },
      include: { role: { select: { id: true, name: true, presetRole: true, permissions: true } } },
      orderBy: { id: 'asc' },
    }),
    getTenantMatrix(resolveTenantId()),
  ]);
  return assignments.map((a) => ({ id: a.role.id, name: a.role.name, presetRole: a.role.presetRole, grid: gridOfRole(a.role, matrix) as Permissions }));
}

class NavService {
  /** Everything /api/auth/me adds for the shell. */
  async getShell(userId: number, role: UserRole) {
    const [permissions, held, owner] = await Promise.all([
      getUserPermissions({ id: userId, role }), heldRoles(userId), prisma.user.findUnique({ where: { id: userId }, select: { preferences: true } }),
    ]);
    const roles = held.length ? held.map((r) => ({ id: r.id, name: r.name })) : [{ id: null, name: ROLE_NAME_BY_USER_ROLE[role] }];
    // "Set up North Star" stays in the menu until the Owner finishes step 6 of the wizard (F-1111)
    const northStarDone = (owner?.preferences as { northStarDone?: boolean } | null)?.northStarDone === true;
    return {
      permissions,
      homeRoute: homeRouteFor(role),
      menu: menuKeysForRoles(role, permissions, held).filter((key) => !(northStarDone && key === 'setupNorthStar')),
      roles,
    };
  }

  /**
   * Pill counts for the signed-in user. A count the user may not see is 0.
   * inbox: unread notifications until the M9 inbox exists. ordersPending: orders in pending_confirmation
   * (a rep or an agent counts only their own). financeOpen: open Findings.
   */
  async getCounts(user: Requester) {
    const permissions = await getUserPermissions(user);
    const has = hasIn(user.role, permissions);

    const [inbox, ordersPending, financeOpen] = await Promise.all([
      prisma.notification.count({ where: { userId: user.id, isRead: false } }),
      has('orders', 'view')
        ? prisma.order.count({ where: { status: 'pending_confirmation', deletedAt: null, ...orderScope(user) } })
        : 0,
      has('financial', 'view') ? prisma.finding.count({ where: { status: 'open' } }) : 0,
    ]);
    return { inbox, ordersPending, financeOpen };
  }
}

export default new NavService();
