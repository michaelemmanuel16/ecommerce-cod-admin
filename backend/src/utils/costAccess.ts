/** Roles that see cost, margin and per-holder stock (F-600): owner, admin, manager, finance clerk, stock keeper. A call rep and a delivery agent do not. */
const COST_ROLES = ['super_admin', 'admin', 'manager', 'accountant', 'inventory_manager'];

export const canSeeCost = (role?: string | null): boolean => role != null && COST_ROLES.includes(role);
