import { menuKeys } from '../../services/navService';

// F-102 / M3b-T10: the Checkout forms item is one role rule, owner, admin and manager. The frontend route guard (AccessGate)
// reads this menu, so a role without the key cannot open /checkout-forms either.
describe('menuKeys: checkoutForms', () => {
  it.each(['super_admin', 'admin', 'manager'] as const)('%s sees it', (role) => {
    expect(menuKeys(role, {})).toContain('checkoutForms');
  });

  it.each(['sales_rep', 'accountant', 'inventory_manager', 'delivery_agent'] as const)('%s does not, even with settings view', (role) => {
    expect(menuKeys(role, { settings: ['view'] })).not.toContain('checkoutForms');
  });
});
