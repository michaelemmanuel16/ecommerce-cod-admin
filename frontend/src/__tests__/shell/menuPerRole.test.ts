import { describe, it, expect } from 'vitest';
import { canOpenPath, visibleGroups } from '../../components/shell/navModel';

// Menu keys as /api/auth/me returns them (backend navService.menuKeysForRoles).
const VIEW_ONLY = ['dashboard', 'inbox', 'orders', 'customers', 'products', 'inventory', 'reports', 'targets', 'leaderboard', 'settings'];
const DASHBOARD_ONLY = ['dashboard', 'inbox', 'settings'];
const labels = (menu: string[], role: string) => visibleGroups(menu, role).flatMap((g) => g.items.map((i) => i.key));

describe('menu per role (F-1163)', () => {
  it('a view-only user sees the view items and none of the write or setup items', () => {
    const keys = labels(VIEW_ONLY, 'manager');
    expect(keys).toEqual(expect.arrayContaining(['dashboard', 'orders', 'customers', 'products', 'inventory', 'reports', 'targets', 'leaderboard', 'settings']));
    for (const hidden of ['checkoutForms', 'messages', 'deliveries', 'finance', 'staff', 'workflows']) expect(keys).not.toContain(hidden);
  });

  it('a view-only user cannot open a page that is not in the menu', () => {
    expect(canOpenPath('/orders', VIEW_ONLY, 'manager', '/')).toBe(true);
    expect(canOpenPath('/staff', VIEW_ONLY, 'manager', '/')).toBe(false);
    expect(canOpenPath('/checkout-forms', VIEW_ONLY, 'manager', '/')).toBe(false);
    expect(canOpenPath('/finance', VIEW_ONLY, 'manager', '/')).toBe(false);
  });

  it('a user with nothing but Dashboard still opens the Dashboard', () => {
    expect(labels(DASHBOARD_ONLY, 'manager')).toContain('dashboard');
    expect(canOpenPath('/', DASHBOARD_ONLY, 'manager', '/')).toBe(true);
    expect(canOpenPath('/', [], 'manager', '/')).toBe(true);
    expect(canOpenPath('/orders', DASHBOARD_ONLY, 'manager', '/')).toBe(false);
  });
});
