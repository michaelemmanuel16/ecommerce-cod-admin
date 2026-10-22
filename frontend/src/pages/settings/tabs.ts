import { BadgeDollarSign, Bell, CreditCard, FileText, ListChecks, Puzzle, Shield, ShieldCheck, Store, UserRound, Users, type LucideIcon } from 'lucide-react';
import type { Action, Resource } from '../../types';

export type SettingsTab =
  | 'profile' | 'security' | 'business' | 'currencies' | 'statuses' | 'notifications' | 'billing'
  | 'users' | 'permissions' | 'integrations' | 'checkout-forms';

export interface TabAccess {
  can: (resource: Resource, action: Action) => boolean;
  isSuperAdmin: boolean;
}

export interface TabDef {
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
  /** `main` tabs are the new sections; `moving` tabs are the old ones that have no new home yet (F-1237). */
  group: 'main' | 'moving';
  /** Who sees the tab (F-1220). A tab with no access is hidden; its URL shows "No access". */
  visible: (a: TabAccess) => boolean;
  /** Who may save on the tab. A view-only person sees the fields and no Save button. */
  editable: (a: TabAccess) => boolean;
}

const everyone = () => true;
const owner = (a: TabAccess) => a.isSuperAdmin;
const viewSettings = (a: TabAccess) => a.can('settings', 'view');
const updateSettings = (a: TabAccess) => a.can('settings', 'update');

/**
 * The Settings sections in menu order. Later milestones add Operations, North Star and targets, Rewards (M6)
 * by adding a row here.
 */
export const SETTINGS_TABS: TabDef[] = [
  { id: 'profile', label: 'Profile', icon: UserRound, group: 'main', visible: everyone, editable: everyone },
  { id: 'security', label: 'Security', icon: ShieldCheck, group: 'main', visible: everyone, editable: everyone },
  { id: 'business', label: 'Business details', icon: Store, group: 'main', visible: viewSettings, editable: updateSettings },
  { id: 'currencies', label: 'Currencies & FX', icon: BadgeDollarSign, group: 'main', visible: viewSettings, editable: updateSettings },
  { id: 'statuses', label: 'Order statuses', icon: ListChecks, group: 'main', visible: viewSettings, editable: updateSettings },
  { id: 'notifications', label: 'Notifications', icon: Bell, group: 'main', visible: everyone, editable: everyone },
  { id: 'billing', label: 'Billing & plans', icon: CreditCard, group: 'main', visible: owner, editable: owner },
  { id: 'users', label: 'User management', icon: Users, group: 'moving', visible: owner, editable: owner },
  { id: 'permissions', label: 'Role permissions', icon: Shield, group: 'moving', visible: owner, editable: owner },
  { id: 'integrations', label: 'Integrations', icon: Puzzle, group: 'moving', visible: owner, editable: owner },
  { id: 'checkout-forms', label: 'Checkout forms', icon: FileText, group: 'moving', visible: owner, editable: owner },
];
