/**
 * Dashboard Registry
 * Maps user roles to dashboard configurations
 */

import { DashboardRegistry } from '../types/dashboard';
import { adminDashboardConfig } from './adminConfig';
import { salesRepConfig } from './salesRepConfig';
import { deliveryAgentConfig } from './deliveryAgentConfig';
import { accountantConfig } from './accountantConfig';
import { inventoryManagerConfig } from './inventoryManagerConfig';

/**
 * Dashboard configuration registry
 * Maps roles to their dashboard configs
 */
export const dashboardConfigs: DashboardRegistry = {
  super_admin: adminDashboardConfig,
  admin: adminDashboardConfig,
  manager: adminDashboardConfig,
  sales_rep: salesRepConfig,
  delivery_agent: deliveryAgentConfig,
  accountant: accountantConfig,
  inventory_manager: inventoryManagerConfig,
};

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
