import { ALL_TOOL_NAMES, ToolName } from './toolPermissions';

/** M2-T02: the roles every tenant starts with. M6 extends the shape (F-1150). */
export interface DefaultRole {
  name: string;
  area: string;
  contract: { purpose: string };
  tools: ToolName[];
  isSystem: boolean;
}

/** The tool names in a role's `tools` JSON column; anything that is not a list reads as no tools. */
export function roleToolList(tools: unknown): string[] {
  return Array.isArray(tools) ? (tools as string[]) : [];
}

export const LEGACY_MCP_ROLE_NAME = 'Legacy MCP (14 tools)';

export const DEFAULT_ROLES: DefaultRole[] = [
  {
    name: 'Owner', area: 'Management', isSystem: false, tools: [...ALL_TOOL_NAMES],
    contract: { purpose: 'Runs the business and sees everything.' },
  },
  {
    name: 'Call rep', area: 'Sales', isSystem: false,
    tools: ['customers_lookup', 'orders_search', 'orders_summary', 'reps_status'],
    contract: { purpose: 'Calls new customers and confirms their orders.' },
  },
  {
    name: 'Delivery', area: 'Delivery', isSystem: false,
    tools: ['deliveries_active', 'orders_search', 'agents_status'],
    contract: { purpose: 'Delivers orders and collects the cash.' },
  },
  {
    name: 'Finance clerk', area: 'Finance', isSystem: false,
    tools: ['financial_summary', 'orders_summary', 'analytics_daily', 'analytics_weekly', 'analytics_monthly'],
    contract: { purpose: 'Keeps the books and checks cash from deliveries.' },
  },
  {
    name: 'Marketing', area: 'Marketing', isSystem: false,
    tools: ['analytics_daily', 'analytics_weekly', 'analytics_monthly', 'orders_summary', 'customers_lookup'],
    contract: { purpose: 'Runs ads and reads what they bring in.' },
  },
  {
    name: 'Stock keeper', area: 'Stock', isSystem: false,
    tools: ['products_inventory', 'orders_search'],
    contract: { purpose: 'Counts stock and prepares orders for dispatch.' },
  },
  {
    name: LEGACY_MCP_ROLE_NAME, area: 'Integrations', isSystem: true, tools: [...ALL_TOOL_NAMES],
    contract: { purpose: 'Old MCP keys keep working with all 14 tools until the owner tightens them.' },
  },
];
