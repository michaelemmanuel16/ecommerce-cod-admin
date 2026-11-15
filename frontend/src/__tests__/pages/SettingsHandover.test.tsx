import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import { Settings } from '../../pages/Settings';
import { SETTINGS_TABS } from '../../pages/settings/tabs';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';

vi.mock('../../services/auth.service', () => ({ authService: { getMe: vi.fn().mockResolvedValue({ user: {}, permissions: {} }) } }));
vi.mock('../../services/admin.service', () => ({
  adminService: { getSystemConfig: vi.fn().mockResolvedValue({}), updateSystemConfig: vi.fn() },
}));
vi.mock('../../components/admin/UserManagementTable', () => ({ UserManagementTable: () => <div>USERS PANEL</div> }));
vi.mock('../../components/admin/RolePermissionsMatrix', () => ({ RolePermissionsMatrix: () => <div>ROLES PANEL</div> }));
vi.mock('../../components/settings/CurrenciesFxPanel', () => ({ CurrenciesFxPanel: () => <div>CURRENCIES PANEL</div> }));
vi.mock('../../pages/settings/BillingTab', () => ({ BillingTab: () => <div>BILLING PANEL</div> }));

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Where />
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route path="/connections" element={<div>CONNECTIONS PAGE</div>} />
          <Route path="/checkout-forms" element={<div>CHECKOUT FORMS PAGE</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuthStore.setState({
    user: { id: 1, email: 'o@shop.com', firstName: 'O', lastName: 'W', role: 'super_admin' } as never,
    permissions: {}, roles: [{ id: null, name: 'super_admin' }], homeRoute: '/', isAuthenticated: true,
  });
});

describe('old URLs keep their parameters (F-1215, F-1237)', () => {
  it('?tab=integrations goes to the Connections page and drops the tab and section', () => {
    renderAt('/settings?tab=integrations&section=whatsapp&from=email');
    expect(screen.getByText('CONNECTIONS PAGE')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/connections?from=email');
  });

  it('a WhatsApp login return (?oauth=) goes to the Connections page with its parameters', () => {
    renderAt('/settings?oauth=error&message=Nope');
    expect(screen.getByText('CONNECTIONS PAGE')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/connections?oauth=error&message=Nope');
  });

  it('?tab=integrations alone goes to /connections', () => {
    renderAt('/settings?tab=integrations');
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/connections$/);
  });

  it('the Settings menu has no Integrations tab any more', () => {
    expect(SETTINGS_TABS.find((t) => (t.id as string) === 'integrations')).toBeUndefined();
  });

  it('?tab=users stays on User management until Staff ships (M6)', () => {
    renderAt('/settings?tab=users');
    expect(screen.getByText('USERS PANEL')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/settings?tab=users');
  });

  it('?tab=roles opens Role permissions', () => {
    renderAt('/settings?tab=roles');
    expect(screen.getByText('ROLES PANEL')).toBeInTheDocument();
  });

  it('?tab=forms goes to the Checkout forms page and keeps other parameters', () => {
    renderAt('/settings?tab=forms&from=email');
    expect(screen.getByText('CHECKOUT FORMS PAGE')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/checkout-forms?from=email');
  });

  it('Currencies and FX is mounted in the shell', () => {
    renderAt('/settings?tab=currencies');
    expect(screen.getByText('CURRENCIES PANEL')).toBeInTheDocument();
  });
});

/**
 * Handover checklist (F-1237): every field the old Settings page saved, the endpoint that stores it, and where it
 * lives now. A field whose new home ships later carries the milestone and stays reachable on its old tab.
 */
type Home = { page: string; milestone: 'M3' | 'M6' | 'M9' };
// Fields of the old Integrations tab: tab 'connections' means the Connections page (M9-T44), not a Settings tab.
const CHECKLIST: { field: string; tab: string; stores: string; source: string; home: Home }[] = [
  ...['Business name', 'Contact person', 'Contact email', 'Business phone', 'Customer support WhatsApp', 'Tax ID (TIN)', 'Business address', 'Time zone']
    .map((field) => ({ field, tab: 'business', stores: '/api/admin/settings', source: 'services/admin.service.ts', home: { page: 'Settings, Business details', milestone: 'M3' as const } })),
  { field: 'Store currency', tab: 'currencies', stores: '/api/admin/settings', source: 'services/admin.service.ts', home: { page: 'Settings, Currencies & FX', milestone: 'M3' } },
  { field: 'Manual exchange rate', tab: 'currencies', stores: '/api/fx/rates', source: 'services/fx.service.ts', home: { page: 'Settings, Currencies & FX', milestone: 'M3' } },
  { field: 'Use today\'s rate', tab: 'currencies', stores: '/api/fx/use-today', source: 'services/fx.service.ts', home: { page: 'Settings, Currencies & FX', milestone: 'M3' } },
  { field: 'Subscribe to a plan', tab: 'billing', stores: '/api/billing/start-subscription', source: 'services/billing.service.ts', home: { page: 'Settings, Billing & plans', milestone: 'M3' } },
  { field: 'Cancel subscription', tab: 'billing', stores: '/api/billing/cancel-subscription', source: 'services/billing.service.ts', home: { page: 'Settings, Billing & plans', milestone: 'M3' } },
  { field: 'User create and edit', tab: 'users', stores: '/api/admin/users', source: 'services/admin.service.ts', home: { page: 'Staff', milestone: 'M6' } },
  { field: 'Role permission matrix', tab: 'permissions', stores: '/api/admin/permissions', source: 'services/admin.service.ts', home: { page: 'Staff', milestone: 'M6' } },
  { field: 'SMS provider', tab: 'connections', stores: '/api/admin/settings', source: 'services/admin.service.ts', home: { page: 'Connections', milestone: 'M9' } },
  { field: 'WhatsApp provider', tab: 'connections', stores: '/api/admin/settings', source: 'services/admin.service.ts', home: { page: 'Connections', milestone: 'M9' } },
  { field: 'Email provider', tab: 'connections', stores: '/api/admin/settings', source: 'services/admin.service.ts', home: { page: 'Connections', milestone: 'M9' } },
  { field: 'Paystack keys', tab: 'connections', stores: '/api/payment-connections', source: 'services/connections.service.ts', home: { page: 'Connections', milestone: 'M9' } },
  { field: 'AI Assistant key (MCP)', tab: 'connections', stores: '/api/mcp-keys', source: 'components/settings/integrations/McpIntegration.tsx', home: { page: 'Connections', milestone: 'M9' } },
  { field: 'Inbound order webhooks', tab: 'connections', stores: '/api/webhooks', source: 'services/webhooks.service.ts', home: { page: 'Connections', milestone: 'M9' } },
];

describe('handover checklist (F-1237)', () => {
  const SRC = path.resolve(__dirname, '../..');
  const owner = { can: () => true, isSuperAdmin: true };

  it.each(CHECKLIST.map((c) => [c.field, c] as const))('%s: its endpoint is in the service and its tab is open to the owner', (_name, c) => {
    expect(fs.readFileSync(path.join(SRC, c.source), 'utf8')).toContain(c.stores);
    if (c.tab === 'connections') return;
    const tab = SETTINGS_TABS.find((t) => t.id === c.tab);
    expect(tab, `tab ${c.tab}`).toBeDefined();
    expect(tab!.visible(owner)).toBe(true);
  });

  it('every field names its new home and a milestone; fields that move later stay on their old tab', () => {
    for (const c of CHECKLIST) {
      expect(c.home.milestone).toMatch(/^M\d+$/);
      if (c.tab === 'connections') expect(c.home.page).toBe('Connections');
      else if (c.home.milestone !== 'M3') expect(SETTINGS_TABS.find((t) => t.id === c.tab)?.group).toBe('moving');
    }
    expect(CHECKLIST.filter((c) => c.home.milestone === 'M6').length).toBeGreaterThan(0);
    expect(CHECKLIST.filter((c) => c.home.milestone === 'M9').length).toBeGreaterThan(0);
  });
});
