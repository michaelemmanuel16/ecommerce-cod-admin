import { describe, it, expect } from '@jest/globals';
import {
  ROLE_TOOLS, ROLE_TOOL_TOTAL, applySwitches, gridFromSwitches, missingReadTools, registryToolsForGrid, registryToolsOfRole, sameGrid, switchesOn,
} from '../../config/roleToolRules';
import { PERMISSION_CATALOG, defaultRolePermissions, unionPermissions } from '../../config/defaultRolePermissions';
import { ALL_TOOL_NAMES } from '../../config/toolPermissions';

describe('the 16 switches (M6-T04, F-1153)', () => {
  it('are 7 read and 9 write, and every cell is in the permission catalog', () => {
    expect(ROLE_TOOL_TOTAL).toBe(16);
    expect(ROLE_TOOLS.filter((t) => t.kind === 'read')).toHaveLength(7);
    expect(ROLE_TOOLS.filter((t) => t.kind === 'write')).toHaveLength(9);
    for (const tool of ROLE_TOOLS) {
      for (const cell of tool.cells) {
        const [resource, action] = cell.split(':');
        expect(PERMISSION_CATALOG[resource]).toContain(action);
      }
      if (tool.requires) expect(ROLE_TOOLS.find((t) => t.key === tool.requires)?.kind).toBe('read');
    }
  });

  it('a write switch without its read switch names the read switch', () => {
    expect(missingReadTools(['update_order_status'])).toEqual(['View orders']);
    expect(missingReadTools(['update_order_status', 'view_customers'])).toEqual(['View orders']);
    expect(missingReadTools(['update_order_status', 'view_orders'])).toEqual([]);
    expect(missingReadTools(['edit_targets', 'adjust_stock'])).toEqual(['View targets', 'View stock']);
    expect(missingReadTools(['manage_team', 'view_orders'])).toEqual([]);
  });

  it('a switch is on when all its cells are granted', () => {
    expect(switchesOn({ products: ['view', 'create'] })).toEqual(['view_stock']);
    expect(switchesOn({ products: ['view', 'create', 'update'] })).toEqual(['view_stock', 'edit_products']);
    expect(switchesOn({ users: ['create'] })).toEqual([]);
  });

  it('turning a switch off removes its cells, but not a cell another switch that stays on needs', () => {
    const grid = gridFromSwitches(['view_stock', 'edit_products', 'adjust_stock']);
    expect(grid.products.sort()).toEqual(['create', 'update', 'update_stock', 'view']);
    const off = applySwitches(grid, ['view_stock', 'adjust_stock']);
    expect(off.products.sort()).toEqual(['update_stock', 'view']);
    // cells no switch owns are kept
    expect(applySwitches({ gl: ['view'], orders: ['view', 'delete'] }, ['view_orders']).gl).toEqual(['view']);
    expect(applySwitches({ orders: ['view', 'delete'] }, []).orders).toEqual(['delete']);
  });

  it('the grid of the switches turns on exactly those switches', () => {
    for (const keys of [[], ['view_orders'], ['view_orders', 'assign_orders', 'update_order_status'], ROLE_TOOLS.map((t) => t.key)]) {
      expect(switchesOn(gridFromSwitches(keys)).sort()).toEqual([...keys].sort());
    }
  });

  it('the Owner defaults turn on all 16', () => {
    expect(switchesOn(defaultRolePermissions().super_admin)).toHaveLength(16);
  });

  it('sameGrid ignores order and empty lists', () => {
    expect(sameGrid({ a: ['x', 'y'], b: [] }, { a: ['y', 'x'] })).toBe(true);
    expect(sameGrid({ a: ['x'] }, { a: ['y'] })).toBe(false);
  });
});

describe('MCP tools follow the grid (F-1153)', () => {
  it('a registry tool is allowed when its cell is granted', () => {
    expect(registryToolsForGrid({ orders: ['view'] }).sort()).toEqual(['deliveries_active', 'orders_search', 'orders_summary']);
    expect(registryToolsForGrid({})).toEqual([]);
    expect(registryToolsForGrid(defaultRolePermissions().super_admin)).toHaveLength(ALL_TOOL_NAMES.length);
  });

  it('the system role keeps its stored list; other roles use the grid', () => {
    expect(registryToolsOfRole({ isSystem: true, tools: ['orders_search', 'not_a_tool'], permissions: null, presetRole: null })).toEqual(['orders_search']);
    expect(registryToolsOfRole({ isSystem: false, tools: ['orders_search'], permissions: { customers: ['view'] }, presetRole: null })).toEqual(['customers_lookup']);
    expect(registryToolsOfRole({ isSystem: false, tools: [], permissions: null, presetRole: 'accountant' })).toContain('financial_summary');
  });
});

describe('permission grids', () => {
  it('union keeps every action any grid gives, without repeats', () => {
    const union = unionPermissions([{ orders: ['view', 'update'], gl: ['view'] }, { orders: ['view', 'assign'] }, null, undefined]);
    expect(union.orders.sort()).toEqual(['assign', 'update', 'view']);
    expect(union.gl).toEqual(['view']);
    expect(unionPermissions([])).toEqual({});
  });

  it('the catalog holds every cell of the default matrix for all seven roles', () => {
    for (const grid of Object.values(defaultRolePermissions())) {
      for (const [resource, actions] of Object.entries(grid as Record<string, string[]>)) {
        expect(PERMISSION_CATALOG).toHaveProperty(resource);
        for (const a of actions) expect(PERMISSION_CATALOG[resource]).toContain(a);
      }
    }
  });
});
