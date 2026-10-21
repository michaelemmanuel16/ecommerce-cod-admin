import {
  LayoutGrid, Inbox, ShoppingBag, Users, FileText, MessageCircle, Package, Boxes, Truck, Wallet,
  Megaphone, BarChart3, Target, Trophy, UserCog, Workflow, Plug, Settings, Flag,
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
}

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
    ],
  },
  {
    label: 'Money',
    items: [
      { key: 'finance', label: 'Finance', icon: Wallet, to: '/finance', count: 'financeOpen' },
      { key: 'marketing', label: 'Marketing', icon: Megaphone, to: null }, // M8
      { key: 'reports', label: 'Reports', icon: BarChart3, to: '/analytics' }, // the current Analytics page, until M3-T60
    ],
  },
  {
    label: 'Team',
    items: [
      { key: 'targets', label: 'Targets', icon: Target, to: null },
      { key: 'leaderboard', label: 'Leaderboard', icon: Trophy, to: null },
      { key: 'staff', label: 'Staff & roles', icon: UserCog, to: null },
    ],
  },
  {
    label: 'Setup',
    items: [
      { key: 'workflows', label: 'Workflows', icon: Workflow, to: '/workflows' },
      { key: 'connections', label: 'Connections', icon: Plug, to: null },
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
export function visibleGroups(menu: string[]): NavGroup[] {
  const allowed = new Set(menu);
  return NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => i.to !== null && allowed.has(i.key)) }))
    .filter((g) => g.items.length > 0);
}

/** Active item: the route itself or a page under it (/orders/12 keeps Orders lit). "/" matches only itself. */
export function isActive(to: string, pathname: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`);
}
