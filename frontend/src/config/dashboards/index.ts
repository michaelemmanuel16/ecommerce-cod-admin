/**
 * Dashboard Registry
 * Maps user roles to dashboard configurations
 */

import { DashboardRegistry } from '../types/dashboard';
import { salesRepConfig } from './salesRepConfig';
import { deliveryAgentConfig } from './deliveryAgentConfig';
import { features } from '../features';

/**
 * Dashboard configuration registry
 * Only the call rep and delivery agent dashboards are left (M3-T41): they stay until the rep app (M7) and the agent app (M10)
 * replace them. The owner, admin and manager Dashboard is pages/Dashboard.tsx; the finance clerk and stock keeper have other homes.
 */
const baseConfigs: DashboardRegistry = {
  sales_rep: salesRepConfig,
  delivery_agent: deliveryAgentConfig,
};

/**
 * Dashboard configuration registry
 * Note: salesRepConfig is excluded when features.repApp is active
 */
export const dashboardConfigs: DashboardRegistry = new Proxy(baseConfigs, {
  get(target, prop: string) {
    if (prop === 'sales_rep' && features.repApp) return undefined;
    return target[prop];
  },
  has(target, prop: string) {
    if (prop === 'sales_rep' && features.repApp) return false;
    return prop in target;
  },
  ownKeys(target) {
    const keys = Reflect.ownKeys(target);
    if (features.repApp) {
      return keys.filter((k) => k !== 'sales_rep');
    }
    return keys;
  },
  getOwnPropertyDescriptor(target, prop: string) {
    if (prop === 'sales_rep' && features.repApp) return undefined;
    return Reflect.getOwnPropertyDescriptor(target, prop);
  },
});

/**
 * Get dashboard config for a specific role
 * @param role - User role
 * @returns Dashboard config or undefined if not found
 */
export function getDashboardConfig(role: string) {
  return dashboardConfigs[role];
}

/**
 * Check if a role has a dashboard configured
 * @param role - User role
 * @returns True if dashboard config exists
 */
export function hasDashboardConfig(role: string): boolean {
  return role in dashboardConfigs;
}
