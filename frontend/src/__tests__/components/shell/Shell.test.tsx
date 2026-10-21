import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Shell } from '../../../components/shell/Shell';
import { useV2Page } from '../../../components/shell/useV2Page';
import { useAuthStore } from '../../../stores/authStore';
import { useConfigStore } from '../../../stores/configStore';
import { useShellStore } from '../../../stores/shellStore';
import { navService } from '../../../services/nav.service';
import { authService } from '../../../services/auth.service';
import { platformService } from '../../../services/platform.service';

vi.mock('../../../services/nav.service', () => ({ navService: { getCounts: vi.fn() } }));
vi.mock('../../../services/auth.service', () => ({ authService: { logout: vi.fn(), getMe: vi.fn() } }));
vi.mock('../../../services/platform.service', () => ({ platformService: { getActiveAnnouncements: vi.fn() } }));
vi.mock('../../../services/billing.service', () => ({ billingService: { getSubscription: vi.fn().mockRejectedValue(new Error('none')) } }));

const OWNER_MENU = ['dashboard', 'inbox', 'orders', 'customers', 'products', 'finance', 'targets', 'settings'];

const owner = {
  id: 1, email: 'm@example.com', firstName: 'Manny', lastName: 'Owner', role: 'super_admin' as const,
  createdAt: '', updatedAt: '',
};

function signIn(user = owner, menu = OWNER_MENU) {
  useAuthStore.setState({
    user, accessToken: 'a', refreshToken: 'r', permissions: {}, isAuthenticated: true,
    menu, homeRoute: '/', roles: [{ id: 1, name: 'Owner' }, { id: 2, name: 'Finance clerk' }],
  });
}

function RestyledPage() {
  useV2Page();
  return <p>Restyled page</p>;
}

function renderShell(path = '/orders') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>Login page</p>} />
        <Route element={<Shell />}>
          <Route path="orders" element={<p>Orders page</p>} />
          <Route path="restyled" element={<RestyledPage />} />
          <Route path="customers" element={<p>Customers page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(navService.getCounts).mockResolvedValue({ inbox: 0, ordersPending: 64, financeOpen: 2 });
    vi.mocked(authService.logout).mockResolvedValue(undefined);
    vi.mocked(platformService.getActiveAnnouncements).mockResolvedValue({ announcements: [] });
    useConfigStore.setState({ businessName: 'Manny Dynamics', currency: 'GHS', loaded: true });
    useShellStore.setState({ counts: null });
    signIn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('shows the Orders pill with the ordersPending count', async () => {
    renderShell();
    const orders = await screen.findByRole('link', { name: /Orders/ });
    await waitFor(() => expect(within(orders).getByText('64')).toBeInTheDocument());
    expect(within(screen.getByRole('link', { name: /Finance/ })).getByText('2')).toBeInTheDocument();
  });

  it('hides the pills when the count request fails, and the menu still works', async () => {
    vi.mocked(navService.getCounts).mockRejectedValue(new Error('down'));
    renderShell();
    const orders = await screen.findByRole('link', { name: /Orders/ });
    expect(within(orders).queryByText('64')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: /Customers/ }));
    expect(await screen.findByText('Customers page')).toBeInTheDocument();
  });

  it('shows only menu keys that have a page: targets has none yet', async () => {
    renderShell();
    await screen.findByRole('link', { name: /Orders/ });
    expect(screen.queryByRole('link', { name: /Targets/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Marketing/ })).not.toBeInTheDocument(); // not in the menu
    expect(screen.getByRole('link', { name: 'Finance 2 waiting' })).toHaveAttribute('href', '/finance');
    expect(screen.getByRole('link', { name: /Orders/ })).toHaveAttribute('aria-current', 'page');
  });

  it('shows the store chip and the role names, with no store switcher', async () => {
    renderShell();
    expect(await screen.findByText('Manny Dynamics')).toBeInTheDocument();
    expect(screen.getByText(/Ghana/)).toBeInTheDocument();
    expect(screen.getByText('Owner · Finance clerk')).toBeInTheDocument();
    expect(screen.queryByText(/2 stores/i)).not.toBeInTheDocument();
  });

  it('renders a skeleton, not the page, until the store config has loaded', async () => {
    useConfigStore.setState({ loaded: false });
    renderShell();
    await screen.findByRole('link', { name: /Orders/ });
    expect(screen.queryByText('Orders page')).not.toBeInTheDocument();
    useConfigStore.setState({ loaded: true });
    expect(await screen.findByText('Orders page')).toBeInTheDocument();
  });

  describe('collapse', () => {
    it('collapses and remembers it', async () => {
      renderShell();
      await userEvent.click(await screen.findByRole('button', { name: 'Collapse sidebar' }));
      expect(document.querySelector('.app')).toHaveClass('collapsed');
      expect(localStorage.getItem('sidebarCollapsed')).toBe('true');
    });

    it('starts collapsed when it was saved', async () => {
      localStorage.setItem('sidebarCollapsed', 'true');
      renderShell();
      expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    });

    it('works with localStorage throwing: opens expanded, toggles, no crash', async () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
      renderShell();
      const button = await screen.findByRole('button', { name: 'Collapse sidebar' });
      expect(document.querySelector('.app')).not.toHaveClass('collapsed');
      await userEvent.click(button);
      expect(document.querySelector('.app')).toHaveClass('collapsed');
      expect(screen.getByText('Orders page')).toBeInTheDocument();
    });
  });

  it('opens the sidebar drawer with the top bar button under 760 px', async () => {
    renderShell();
    const toggle = await screen.findByRole('button', { name: 'Open menu' });
    await userEvent.click(toggle);
    expect(document.querySelector('.side')).toHaveClass('open');
    await userEvent.click(screen.getByRole('link', { name: /Customers/ }));
    await waitFor(() => expect(document.querySelector('.side')).not.toHaveClass('open'));
  });

  describe('user menu', () => {
    it('opens with Profile, Security and Sign out, and closes with Escape', async () => {
      renderShell();
      await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
      expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveAttribute('href', '/settings?tab=profile');
      expect(screen.getByRole('menuitem', { name: 'Security' })).toHaveAttribute('href', '/settings?tab=security');
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('menuitem', { name: 'Sign out' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Account menu' })).toHaveFocus();
    });

    it('Sign out clears the tokens and goes to /login', async () => {
      renderShell();
      await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
      expect(await screen.findByText('Login page')).toBeInTheDocument();
      const state = useAuthStore.getState();
      expect(state.accessToken).toBeNull();
      expect(state.refreshToken).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(authService.logout).toHaveBeenCalled();
    });

    it('Sign out still works when the logout request fails', async () => {
      vi.mocked(authService.logout).mockRejectedValue(new Error('offline'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      renderShell();
      await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
      expect(await screen.findByText('Login page')).toBeInTheDocument();
      expect(useAuthStore.getState().accessToken).toBeNull();
    });
  });

  describe('banners', () => {
    const announcement = { id: 'a1', title: 'Maintenance tonight', body: 'Short break at 22:00.', type: 'maintenance' };

    it('shows an announcement above the page, and dismisses it', async () => {
      vi.mocked(platformService.getActiveAnnouncements).mockResolvedValue({ announcements: [announcement] } as never);
      renderShell();
      expect(await screen.findByText('Maintenance tonight')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Dismiss announcement' }));
      expect(screen.queryByText('Maintenance tonight')).not.toBeInTheDocument();
    });

    it.each(['sales_rep', 'delivery_agent'] as const)('does not show it to a %s', async (role) => {
      vi.mocked(platformService.getActiveAnnouncements).mockResolvedValue({ announcements: [announcement] } as never);
      signIn({ ...owner, role }, ['dashboard', 'orders']);
      renderShell();
      await screen.findByRole('link', { name: /Orders/ });
      expect(screen.queryByText('Maintenance tonight')).not.toBeInTheDocument();
      expect(platformService.getActiveAnnouncements).not.toHaveBeenCalled();
    });
  });

  describe('old pages whose new home ships later', () => {
    it('an owner sees Customer reps and Webhooks', async () => {
      renderShell();
      expect(await screen.findByRole('link', { name: 'Customer reps' })).toHaveAttribute('href', '/customer-reps');
      expect(screen.getByRole('link', { name: 'Webhooks' })).toHaveAttribute('href', '/webhooks');
      expect(screen.queryByRole('link', { name: 'Earnings history' })).not.toBeInTheDocument();
    });

    it('a delivery agent sees Agent stock, not Customer reps or Webhooks', async () => {
      signIn({ ...owner, role: 'delivery_agent' }, ['orders']);
      renderShell();
      expect(await screen.findByRole('link', { name: 'Agent stock' })).toHaveAttribute('href', '/agent-inventory');
      expect(screen.queryByRole('link', { name: 'Customer reps' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Webhooks' })).not.toBeInTheDocument();
    });

    it('a call rep sees Earnings history only', async () => {
      signIn({ ...owner, role: 'sales_rep' }, ['orders']);
      renderShell();
      expect(await screen.findByRole('link', { name: 'Earnings history' })).toHaveAttribute('href', '/earnings-history');
      expect(screen.queryByRole('link', { name: 'Agent stock' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Customer reps' })).not.toBeInTheDocument();
    });
  });

  describe('dark mode and old pages', () => {
    it('wraps a not-restyled page in .legacy-light, so it stays light inside the dark shell', async () => {
      renderShell('/orders');
      expect((await screen.findByText('Orders page')).parentElement).toHaveClass('legacy-light');
    });

    it('a page that calls useV2Page opts in to dark: no wrapper', async () => {
      renderShell('/restyled');
      const page = await screen.findByText('Restyled page');
      await waitFor(() => expect(page.parentElement).not.toHaveClass('legacy-light'));
    });
  });

  it('the moon button toggles dark mode', async () => {
    renderShell();
    await userEvent.click(await screen.findByRole('button', { name: 'Toggle dark mode' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('has mount points for the palette and the AI drawer, and the search box and Ask agent flip their flags', async () => {
    renderShell();
    await screen.findByRole('link', { name: /Orders/ });
    expect(document.getElementById('command-palette-root')).not.toBeNull();
    expect(document.getElementById('ai-drawer-root')).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Search orders/ }));
    expect(useShellStore.getState().paletteOpen).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /Ask agent/ }));
    expect(useShellStore.getState().drawerOpen).toBe(true);
  });
});
