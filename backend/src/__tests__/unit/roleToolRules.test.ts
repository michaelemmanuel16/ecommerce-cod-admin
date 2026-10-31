import { describe, it, expect } from '@jest/globals';
import { missingReadTools } from '../../config/roleToolRules';
import { PERMISSION_CATALOG, defaultRolePermissions, unionPermissions } from '../../config/defaultRolePermissions';

describe('missingReadTools (M6-T04, F-1153)', () => {
  it('a write tool without a read tool on its resource names the read side', () => {
    expect(missingReadTools(['orders_update_status'])).toEqual(['View orders']);
    expect(missingReadTools(['orders_update_status', 'customers_lookup'])).toEqual(['View orders']);
  });

  it('any read tool on the resource is enough', () => {
    for (const read of ['orders_search', 'orders_summary', 'deliveries_active']) {
      expect(missingReadTools(['orders_update_status', read])).toEqual([]);
    }
  });

  it('read tools stand alone; a write tool on a resource with no read tool has no dependency', () => {
    expect(missingReadTools(['orders_search', 'analytics_daily'])).toEqual([]);
    expect(missingReadTools(['partner_payout_record'])).toEqual([]);
    expect(missingReadTools([])).toEqual([]);
  });

  it('ignores names that are not tools', () => {
    expect(missingReadTools(['not_a_tool'])).toEqual([]);
  });
});

describe('permission grids (M6-T04)', () => {
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
