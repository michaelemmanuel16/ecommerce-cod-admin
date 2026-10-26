/**
 * M2-T02: registry tool name -> permission cell ("resource:action", the same cells the
 * role permission middleware uses). One map: M6 builds the 16 role switches on it.
 * Every MCP tool needs an entry (unit test).
 */
export const TOOL_PERMISSIONS = {
  agents_status: 'users:view',
  agents_performance: 'analytics:view',
  analytics_daily: 'analytics:view',
  analytics_weekly: 'analytics:view',
  analytics_monthly: 'analytics:view',
  customers_lookup: 'customers:view',
  deliveries_active: 'orders:view',
  financial_summary: 'financial:view',
  orders_search: 'orders:view',
  orders_summary: 'orders:view',
  orders_update_status: 'orders:update_status',
  // M5-T10: the one generic partner payout action; the key's role needs the payouts permission (decision O7)
  partner_payout_record: 'payouts:create',
  products_inventory: 'products:view',
  reps_status: 'users:view',
  reps_performance: 'analytics:view',
} as const;

export type ToolName = keyof typeof TOOL_PERMISSIONS;

export const ALL_TOOL_NAMES = Object.keys(TOOL_PERMISSIONS) as ToolName[];
