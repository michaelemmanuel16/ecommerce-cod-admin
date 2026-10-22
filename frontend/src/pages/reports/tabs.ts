import { CircleDollarSign, LayoutDashboard, Megaphone, Package, Truck, Users, type LucideIcon } from 'lucide-react';
import { MANAGER_UP } from '../../components/shell/navModel';
import type { Action, Resource } from '../../types';

export type TabKey = 'overview' | 'sales' | 'delivery' | 'team' | 'products' | 'marketing';

interface TabDef {
  key: TabKey;
  label: string;
  icon: LucideIcon;
  /** False while the tab's milestone has not shipped: the slot exists, nobody sees it (F-1050). */
  built: boolean;
  /** The permission the tab needs, and for Team the roles as well. */
  needs: [Resource, Action];
  roles?: string[];
}

/** The six tabs of F-1050. Products and profit is M5 and Marketing is M8: they stay hidden until then. */
const REPORT_TABS: TabDef[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, built: true, needs: ['analytics', 'view'] },
  { key: 'sales', label: 'Sales & revenue', icon: CircleDollarSign, built: true, needs: ['analytics', 'view'] },
  { key: 'delivery', label: 'Delivery & operations', icon: Truck, built: true, needs: ['analytics', 'view'] },
  { key: 'team', label: 'Team performance', icon: Users, built: true, needs: ['analytics', 'view'], roles: MANAGER_UP },
  { key: 'products', label: 'Products & profit', icon: Package, built: false, needs: ['financial', 'view'] },
  // `marketing` is not in the Resource type until M8
  { key: 'marketing', label: 'Marketing', icon: Megaphone, built: false, needs: ['marketing' as Resource, 'view'] },
];

/** The tabs this person may open: built, with the permission, and (Team) one of the owner roles. */
export function visibleTabs(role: string | undefined, can: (resource: Resource, action: Action) => boolean): TabDef[] {
  if (!role) return [];
  return REPORT_TABS.filter((t) => t.built && can(...t.needs) && (!t.roles || t.roles.includes(role)));
}
