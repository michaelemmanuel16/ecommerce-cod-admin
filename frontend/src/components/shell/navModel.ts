import {
  LayoutGrid, Inbox, ShoppingBag, Users, FileText, MessageCircle, Package, Boxes, Truck, Wallet,
  Megaphone, BarChart3, Target, Trophy, UserCog, Workflow, Plug, Settings, Flag, Phone, Webhook, History, PackageOpen,
  type LucideIcon,
} from 'lucide-react';
import type { NavCounts } from '../../services/nav.service';

// The sidebar of docs/mockups/v2/products.html: Dashboard and Inbox, then Sell, Stock, Money, Team, Setup.
// An item shows when its key is in `menu` from /api/auth/me (no role lists here) AND its page exists (`to` is set).
// `to: null` means the page is not built yet: the item stays hidden, so the sidebar never links to a dead page.

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  to: string | null;
  /** Count shown as the coral pill. */
  count?: keyof NavCounts;
  /** Lit only on `to` itself, not on pages under it. */
  exact?: boolean;
  /**
   * Old page whose new home ships later: not an API menu key. It shows to the roles that could see it before
   * (the old Sidebar condition, or the route guard in App.tsx where it was not in the old Sidebar).
   * Remove the item when its replacement ships.
   */
  oldPageFor?: (role: string) => boolean;
}

const MANAGER_UP = ['super_admin', 'admin', 'manager'];

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: LayoutGrid, to: '/' },
      { key: 'inbox', label: 'Inbox', icon: Inbox, to: null, count: 'inbox' }, // M9
    ],
  },
  {
    label: 'Sell',
    items: [
      { key: 'orders', label: 'Orders', icon: ShoppingBag, to: '/orders', count: 'ordersPending' },
      { key: 'customers', label: 'Customers', icon: Users, to: '/customers' },
      { key: 'checkoutForms', label: 'Checkout forms', icon: FileText, to: '/checkout-forms' },
      { key: 'messages', label: 'Messages', icon: MessageCircle, to: '/communications' }, // the current Communications page
    ],
  },
  {
    label: 'Stock',
    items: [
      { key: 'products', label: 'Products', icon: Package, to: '/products' },
      { key: 'inventory', label: 'Inventory & stock', icon: Boxes, to: null }, // M4
      { key: 'deliveries', label: 'Deliveries', icon: Truck, to: '/delivery-agents' }, // the current Delivery Agents page
      // Agent stock page: replaced by Inventory & stock (M4) and the agent app (M10). Guard in App.tsx.
      { key: 'agentInventory', label: 'Agent stock', icon: PackageOpen, to: '/agent-inventory', oldPageFor: (r) => [...MANAGER_UP, 'inventory_manager', 'delivery_agent'].includes(r) },
    ],
  },
  {
    label: 'Money',
    items: [
      { key: 'finance', label: 'Finance', icon: Wallet, to: '/finance', count: 'financeOpen' },
      { key: 'marketing', label: 'Marketing', icon: Megaphone, to: null }, // M8
      { key: 'reports', label: 'Reports', icon: BarChart3, to: '/analytics' }, // the current Analytics page, until M3-T60
      // Call rep earnings: replaced by the rep app (M7). Old Sidebar: call reps only.
      { key: 'earningsHistory', label: 'Earnings history', icon: History, to: '/earnings-history', oldPageFor: (r) => r === 'sales_rep' },
    ],
  },
  {
    label: 'Team',
    items: [
      { key: 'targets', label: 'Targets', icon: Target, to: null },
      { key: 'leaderboard', label: 'Leaderboard', icon: Trophy, to: null },
      { key: 'staff', label: 'Staff & roles', icon: UserCog, to: null },
      // Customer reps page: replaced by Staff & roles (M6). Old Sidebar: manager and above.
      { key: 'customerReps', label: 'Customer reps', icon: Phone, to: '/customer-reps', oldPageFor: (r) => MANAGER_UP.includes(r) },
    ],
  },
  {
    label: 'Setup',
    items: [
      { key: 'workflows', label: 'Workflows', icon: Workflow, to: '/workflows' },
      { key: 'connections', label: 'Connections', icon: Plug, to: null },
      // Webhooks page: replaced by Connections (M9). Guard in App.tsx: owner and admin.
      { key: 'webhooks', label: 'Webhooks', icon: Webhook, to: '/webhooks', oldPageFor: (r) => r === 'super_admin' || r === 'admin' },
      { key: 'settings', label: 'Settings', icon: Settings, to: '/settings' },
      { key: 'setupNorthStar', label: 'Set up North Star', icon: Flag, to: null },
    ],
  },
];

/** Platform admins manage tenants, not a store: the same links the old sidebar showed them. */
export const PLATFORM_GROUP: NavGroup = {
  label: 'Platform admin',
  items: [
    { key: 'platform', label: 'Platform', icon: LayoutGrid, to: '/platform', exact: true },
    { key: 'platformTenants', label: 'Tenants', icon: Users, to: '/platform/tenants' },
    { key: 'platformBilling', label: 'Billing', icon: Wallet, to: '/platform/billing' },
    { key: 'platformAnnouncements', label: 'Announcements', icon: Megaphone, to: '/platform/announcements' },
  ],
};

/** Groups with only the items this person may see and that have a page. A group left empty is dropped. */
export function visibleGroups(menu: string[], role: string): NavGroup[] {
  const allowed = new Set(menu);
  return NAV_GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((i) => i.to !== null && (i.oldPageFor ? i.oldPageFor(role) : allowed.has(i.key))),
    }))
    .filter((g) => g.items.length > 0);
}

/** Active item: the route itself or a page under it (/orders/12 keeps Orders lit). "/" matches only itself. */
export function isActive(to: string, pathname: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
}
