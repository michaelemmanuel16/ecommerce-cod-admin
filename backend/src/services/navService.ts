import { UserRole } from '@prisma/client';
import prisma from '../utils/prisma';
import { getEffectivePermissions } from '../middleware/auth';
import { orderScope, Requester } from '../utils/authUtils';

/** M3-T07: what the app shell needs per user: counts for the pills, menu keys, home route, role names (F-101, F-102, F-104). */

type Permissions = Record<string, string[]>;

/** Name shown for a base role when the person has no RoleAssignment (F-104). */
const BASE_ROLE_NAME: Record<UserRole, string> = {
  super_admin: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  sales_rep: 'Call rep',
  inventory_manager: 'Stock keeper',
  delivery_agent: 'Delivery',
  accountant: 'Finance clerk',
};

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

export const homeRouteFor = (role: UserRole): string => HOME_ROUTE[role];

/** Role names from RoleAssignment (running today), else the base role name. */
async function roleList(userId: number, role: UserRole): Promise<Array<{ id: number | null; name: string }>> {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const assignments = await prisma.roleAssignment.findMany({
    where: { holderId: userId, fromDate: { lte: today }, OR: [{ toDate: null }, { toDate: { gte: today } }] },
    include: { role: { select: { id: true, name: true } } },
    orderBy: { id: 'asc' },
  });
  const roles = assignments.map((a) => ({ id: a.role.id, name: a.role.name }));
  return roles.length ? roles : [{ id: null, name: BASE_ROLE_NAME[role] }];
}

class NavService {
  /** Everything /api/auth/me adds for the shell. */
  async getShell(userId: number, role: UserRole) {
    const [permissions, roles] = await Promise.all([getEffectivePermissions(role), roleList(userId, role)]);
    return {
      permissions,
      homeRoute: homeRouteFor(role),
      menu: menuKeys(role, permissions),
      roles,
    };
  }

  /**
   * Pill counts for the signed-in user. A count the user may not see is 0.
   * inbox: unread notifications until the M9 inbox exists. ordersPending: orders in pending_confirmation
   * (a rep or an agent counts only their own). financeOpen: open Findings.
   */
  async getCounts(user: Requester) {
    const permissions = await getEffectivePermissions(user.role);
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
