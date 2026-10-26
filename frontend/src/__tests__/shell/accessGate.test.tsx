import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AccessGate } from '../../components/shell/AccessGate';
import { canOpenPath } from '../../components/shell/navModel';
import { features } from '../../config/features';
import { useAuthStore } from '../../stores/authStore';

// Menu keys as /api/auth/me returns them (backend navService MENU_RULES) for each base role.
const MENU = {
  manager: ['dashboard', 'inbox', 'orders', 'customers', 'checkoutForms', 'messages', 'products', 'deliveries', 'reports', 'workflows', 'settings'],
  accountant: ['inbox', 'finance', 'reports', 'settings'],
  inventory_manager: ['inbox', 'products', 'inventory', 'settings'],
  sales_rep: ['inbox', 'orders', 'customers', 'settings'],
  delivery_agent: ['inbox', 'orders', 'settings'],
};

function signIn(role: keyof typeof MENU, homeRoute: string) {
  useAuthStore.setState({
    user: { id: 1, role, firstName: 'T', lastName: 'U', isPlatformAdmin: false } as never,
    menu: MENU[role],
    homeRoute,
    roles: [{ id: null, name: role }],
    isAuthenticated: true,
  });
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AccessGate />}>
          <Route index element={<div>DASHBOARD PAGE</div>} />
          <Route path="orders" element={<div>ORDERS PAGE</div>} />
          <Route path="orders/:id" element={<div>ORDER DETAIL PAGE</div>} />
          <Route path="finance" element={<div>FINANCE PAGE</div>} />
          <Route path="products" element={<div>PRODUCTS PAGE</div>} />
          <Route path="inventory" element={<div>INVENTORY PAGE</div>} />
          <Route path="checkout-forms" element={<div>FORMS PAGE</div>} />
          <Route path="checkout-forms/:id/edit" element={<div>FORM EDITOR PAGE</div>} />
          <Route path="earnings-history" element={<div>EARNINGS PAGE</div>} />
          <Route path="agent-inventory" element={<div>AGENT STOCK PAGE</div>} />
        </Route>
        <Route path="/rep" element={<div>REP APP</div>} />
        <Route path="/agent" element={<div>AGENT APP</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  features.repApp = false;
  features.agentApp = false;
});

describe('canOpenPath', () => {
  it('opens a page whose menu item is present, and pages under it', () => {
    expect(canOpenPath('/orders', MENU.manager, 'manager', '/')).toBe(true);
    expect(canOpenPath('/orders/12', MENU.manager, 'manager', '/')).toBe(true);
  });
  it('closes a page whose menu item is missing', () => {
    expect(canOpenPath('/finance', MENU.manager, 'manager', '/')).toBe(false);
    expect(canOpenPath('/orders', MENU.inventory_manager, 'inventory_manager', '/inventory')).toBe(false);
  });
  it('closes a path no menu item owns', () => {
    expect(canOpenPath('/nothing-here', MENU.manager, 'manager', '/')).toBe(false);
  });
  it('always opens the home route', () => {
    expect(canOpenPath('/', MENU.sales_rep, 'sales_rep', '/')).toBe(true);
    expect(canOpenPath('/finance', ['settings'], 'accountant', '/finance')).toBe(true);
  });
});

describe('AccessGate: checkout forms (M3b-T10)', () => {
  it('the manager opens the list and the editor', () => {
    signIn('manager', '/');
    renderAt('/checkout-forms');
    expect(screen.getByText('FORMS PAGE')).toBeInTheDocument();
  });
  it.each(['accountant', 'inventory_manager', 'sales_rep', 'delivery_agent'] as const)('%s gets "no access" on the list and the editor', (role) => {
    signIn(role, '/');
    // even with the settings menu key, which no longer decides this page
    const first = renderAt('/checkout-forms');
    expect(screen.getByText('You do not have access to this page')).toBeInTheDocument();
    expect(screen.queryByText('FORMS PAGE')).toBeNull();
    first.unmount();
    renderAt('/checkout-forms/5/edit');
    expect(screen.getByText('You do not have access to this page')).toBeInTheDocument();
  });
});

describe('AccessGate', () => {
  it('finance clerk at "/" lands on Finance', () => {
    signIn('accountant', '/finance');
    renderAt('/');
    expect(screen.getByText('FINANCE PAGE')).toBeInTheDocument();
  });
  it('stock keeper at "/" lands on Inventory (M4-T29)', () => {
    signIn('inventory_manager', '/inventory');
    renderAt('/');
    expect(screen.getByText('INVENTORY PAGE')).toBeInTheDocument();
  });
  it('manager at "/" sees the Dashboard', () => {
    signIn('manager', '/');
    renderAt('/');
    expect(screen.getByText('DASHBOARD PAGE')).toBeInTheDocument();
  });
  it('a direct URL to a hidden page shows "no access" and keeps the page out', () => {
    signIn('inventory_manager', '/inventory');
    renderAt('/finance');
    expect(screen.getByText('You do not have access to this page')).toBeInTheDocument();
    expect(screen.queryByText('FINANCE PAGE')).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Inventory & stock' })).toHaveAttribute('href', '/inventory');
  });
  it('shows a loading state until the first /api/auth/me answer', () => {
    signIn('manager', '/');
    useAuthStore.setState({ menu: null });
    renderAt('/orders');
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });
  it('flags off: call rep and delivery agent stay on the current page at "/"', () => {
    signIn('sales_rep', '/');
    const rep = renderAt('/');
    expect(screen.getByText('DASHBOARD PAGE')).toBeInTheDocument();
    rep.unmount();
    signIn('delivery_agent', '/');
    renderAt('/');
    expect(screen.getByText('DASHBOARD PAGE')).toBeInTheDocument();
  });
  it('flags on: call rep goes to /rep and delivery agent to /agent', () => {
    features.repApp = true;
    features.agentApp = true;
    signIn('sales_rep', '/');
    const rep = renderAt('/');
    expect(screen.getByText('REP APP')).toBeInTheDocument();
    rep.unmount();
    signIn('delivery_agent', '/');
    renderAt('/');
    expect(screen.getByText('AGENT APP')).toBeInTheDocument();
  });
  it('rep keeps Earnings history and cannot open Finance', () => {
    signIn('sales_rep', '/');
    const a = renderAt('/earnings-history');
    expect(screen.getByText('EARNINGS PAGE')).toBeInTheDocument();
    a.unmount();
    renderAt('/finance');
    expect(screen.getByText('You do not have access to this page')).toBeInTheDocument();
  });
});
