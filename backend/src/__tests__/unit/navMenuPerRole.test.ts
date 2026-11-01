import { menuKeysForRoles, type HeldRole } from '../../services/navService';
import { defaultRolePermissions } from '../../config/defaultRolePermissions';
import { gridFromSwitches } from '../../config/roleToolRules';

// M6-T21 (F-1163): the menu follows the cells of the roles a person holds. A seeded role keeps its F-102 menu; a custom role,
// such as a view-only one, gets what its cells allow and nothing from its base role.
const defaults = defaultRolePermissions();
const seeded = (presetRole: HeldRole['presetRole'], name: string): HeldRole => ({ presetRole, name, grid: defaults[presetRole as keyof typeof defaults] });
const VIEW_TOOLS = ['view_orders', 'view_customers', 'view_stock', 'view_payouts', 'view_reports', 'view_targets', 'export_data'];
const custom = (tools: string[], presetRole: HeldRole['presetRole'] = 'manager'): HeldRole => ({ presetRole, name: 'Viewer', grid: gridFromSwitches(tools) });

describe('menuKeysForRoles: seeded roles keep their menu', () => {
  it('Owner sees everything', () => {
    expect(menuKeysForRoles('super_admin', defaults.super_admin, [seeded('super_admin', 'Owner')])).toContain('setupNorthStar');
  });
  it('Admin sees everything but Set up North Star', () => {
    const keys = menuKeysForRoles('admin', defaults.admin, [seeded('admin', 'Admin')]);
    expect(keys).toContain('connections');
    expect(keys).not.toContain('setupNorthStar');
  });
  it('Finance clerk', () => {
    expect(menuKeysForRoles('accountant', defaults.accountant, [seeded('accountant', 'Finance clerk')]))
      .toEqual(['inbox', 'orders', 'customers', 'products', 'finance', 'reports', 'leaderboard', 'settings']);
  });
  it('Stock keeper', () => {
    expect(menuKeysForRoles('inventory_manager', defaults.inventory_manager, [seeded('inventory_manager', 'Stock keeper')]))
      .toEqual(['inbox', 'orders', 'customers', 'products', 'inventory', 'leaderboard', 'settings']);
  });
  it('a person with no role follows the base role', () => {
    expect(menuKeysForRoles('accountant', defaults.accountant, [])).toContain('finance');
  });
});

describe('menuKeysForRoles: custom roles follow their cells', () => {
  it('a view-only user (the 7 read tools, base role manager) sees view pages only', () => {
    const grid = gridFromSwitches(VIEW_TOOLS);
    const keys = menuKeysForRoles('manager', grid, [custom(VIEW_TOOLS)]);
    expect(keys).toEqual(['dashboard', 'inbox', 'orders', 'customers', 'products', 'inventory', 'reports', 'targets', 'leaderboard', 'settings']);
    for (const hidden of ['checkoutForms', 'messages', 'deliveries', 'finance', 'staff', 'workflows', 'connections', 'marketing']) expect(keys).not.toContain(hidden);
  });

  it('a user whose role has no tools still has Dashboard, Inbox and Settings', () => {
    expect(menuKeysForRoles('manager', {}, [custom([])])).toEqual(['dashboard', 'inbox', 'settings']);
  });

  it('Staff & roles needs users:view, which no tool switch gives; Deliveries needs orders:assign or users:view', () => {
    // Manage team gives users:create and users:update only
    expect(menuKeysForRoles('manager', gridFromSwitches(['manage_team']), [custom(['manage_team'])])).not.toContain('staff');
    const advanced: HeldRole = { presetRole: 'manager', name: 'Team lead', grid: { users: ['view'] } };
    expect(menuKeysForRoles('manager', advanced.grid, [advanced])).toEqual(expect.arrayContaining(['staff', 'deliveries']));
    const assign = ['view_orders', 'assign_orders'];
    const keys = menuKeysForRoles('manager', gridFromSwitches(assign), [custom(assign)]);
    expect(keys).toContain('deliveries');
    expect(keys).not.toContain('staff');
  });

  it('Edit products shows Checkout forms', () => {
    const tools = ['view_stock', 'edit_products'];
    expect(menuKeysForRoles('manager', gridFromSwitches(tools), [custom(tools)])).toContain('checkoutForms');
  });

  it('holding two roles gives the union of their items', () => {
    const viewer = custom(['view_orders']);
    const finance = seeded('accountant', 'Finance clerk');
    const keys = menuKeysForRoles('accountant', defaults.accountant, [viewer, finance]);
    expect(keys).toEqual(expect.arrayContaining(['dashboard', 'orders', 'finance', 'reports']));
    expect(keys.indexOf('dashboard')).toBeLessThan(keys.indexOf('finance'));
  });
});
