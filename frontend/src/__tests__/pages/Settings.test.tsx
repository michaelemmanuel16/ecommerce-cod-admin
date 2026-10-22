import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Settings } from '../../pages/Settings';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';

const getMe = vi.fn();
vi.mock('../../services/auth.service', () => ({
  authService: {
    getMe: (...a: unknown[]) => getMe(...a),
    deleteAccount: vi.fn(),
  },
}));
vi.mock('../../services/admin.service', () => ({
  adminService: { getSystemConfig: vi.fn().mockResolvedValue({}), updateSystemConfig: vi.fn() },
}));
const updateProfile = vi.fn();
vi.mock('../../services/account.service', () => ({
  accountService: {
    updateProfile: (...a: unknown[]) => updateProfile(...a),
    uploadPhoto: vi.fn(),
    removePhoto: vi.fn(),
    changePassword: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
    revokeSession: vi.fn(),
    revokeOthers: vi.fn(),
    exportMyData: vi.fn(),
  },
}));
// The old tabs open big panels with their own API calls; they are not under test here
vi.mock('../../components/admin/UserManagementTable', () => ({ UserManagementTable: () => <div>USERS PANEL</div> }));
vi.mock('../../components/admin/RolePermissionsMatrix', () => ({ RolePermissionsMatrix: () => <div>ROLES PANEL</div> }));
vi.mock('../../components/settings/IntegrationsPanel', () => ({ IntegrationsPanel: () => <div>INTEGRATIONS PANEL</div> }));
vi.mock('../../components/settings/CurrenciesFxPanel', () => ({ CurrenciesFxPanel: () => <div>CURRENCIES PANEL</div> }));
vi.mock('../../pages/Billing', () => ({ Billing: () => <div>BILLING PANEL</div> }));

const ME = { id: 1, email: 'ama@shop.com', firstName: 'Ama', lastName: 'Mensah Boateng', displayName: 'Ama', phoneNumber: '+233245550182', photoUrl: null, role: 'admin', createdAt: '2026-01-02T00:00:00.000Z' };

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.pathname + loc.search}</output>;
}

function renderAt(url = '/settings') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ToastProvider>
        <Where />
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route path="/" element={<div>HOME</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const signIn = (role: string, permissions: Record<string, string[]> = {}) =>
  useAuthStore.setState({
    user: { ...ME, role } as never,
    permissions,
    roles: [{ id: null, name: role }],
    homeRoute: '/',
    isAuthenticated: true,
  });

const tabNames = () => screen.getAllByRole('button').filter((b) => b.closest('nav')).map((b) => b.textContent);

beforeEach(() => {
  [getMe, updateProfile].forEach((m) => m.mockReset());
  getMe.mockResolvedValue({ user: ME, permissions: {} });
});

describe('Settings shell: tabs by permission (F-1220)', () => {
  it('a sales rep sees Profile and Security only', () => {
    signIn('sales_rep');
    renderAt();
    expect(tabNames()).toEqual(['Profile', 'Security', 'Notifications']);
  });

  it('an admin with settings:view sees the view-only tabs and no owner tabs', () => {
    signIn('admin', { settings: ['view'] });
    renderAt();
    expect(tabNames()).toEqual(['Profile', 'Security', 'Business details', 'Currencies & FX', 'Notifications']);
  });

  it('the owner sees every tab, the old ones under "Moving soon"', () => {
    signIn('super_admin');
    renderAt();
    expect(tabNames()).toEqual([
      'Profile', 'Security', 'Business details', 'Currencies & FX', 'Notifications', 'Billing & plans',
      'User management', 'Role permissions', 'Integrations', 'Checkout forms',
    ]);
    expect(screen.getByText('Moving soon')).toBeInTheDocument();
  });

  it('a click puts ?tab= in the URL and opens the old content', async () => {
    signIn('super_admin');
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: 'Billing & plans' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/settings?tab=billing');
    expect(screen.getByText('BILLING PANEL')).toBeInTheDocument();
  });

  it('a tab the person may not open shows "No access" and the URL stays', () => {
    signIn('admin', { settings: ['view'] });
    renderAt('/settings?tab=billing');
    expect(screen.getByText('You do not have access to this page')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/settings?tab=billing');
  });

  it('a sales rep opens Notifications: a pointer card with a disabled button', () => {
    signIn('sales_rep');
    renderAt('/settings?tab=notifications');
    expect(screen.getByText('Notification settings will live in Inbox')).toBeInTheDocument();
    expect(screen.getByText('Inbox is coming soon.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Inbox settings' })).toBeDisabled();
  });

  it('an unknown tab opens Profile', () => {
    signIn('sales_rep');
    renderAt('/settings?tab=nonsense');
    expect(screen.getByRole('heading', { name: 'Profile' })).toBeInTheDocument();
  });

  it('an admin on Business details cannot reach the owner form', () => {
    signIn('admin', { settings: ['view'] });
    renderAt('/settings?tab=business');
    expect(screen.getByText(/view this section but not change it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });
});

describe('Profile tab (F-1221, F-1222)', () => {
  beforeEach(() => signIn('sales_rep'));

  it('shows one Full name input, the +233 phone placeholder and English only', async () => {
    renderAt();
    expect(screen.getByLabelText('Full name')).toHaveValue('Ama Mensah Boateng');
    await waitFor(() => expect(screen.getByLabelText('Phone')).toHaveValue('+233245550182'));
    expect(screen.getByLabelText('Phone')).toHaveAttribute('placeholder', '+233 24 000 0000');
    expect(screen.getByLabelText('Language')).toHaveValue('English');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/time zone/i)).not.toBeInTheDocument();
  });

  it('save sends the form, then the header user has the new name and display name', async () => {
    updateProfile.mockResolvedValue({ ...ME, firstName: 'Adwoa', lastName: 'Mensah', displayName: 'Dee' });
    renderAt();
    await waitFor(() => expect(screen.getByLabelText('Phone')).toHaveValue('+233245550182'));
    const name = screen.getByLabelText('Full name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Adwoa Mensah');
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ name: 'Adwoa Mensah', displayName: 'Ama', email: 'ama@shop.com', phone: '+233245550182' }));
    expect(useAuthStore.getState().user).toMatchObject({ firstName: 'Adwoa', lastName: 'Mensah', displayName: 'Dee' });
    expect(await screen.findByText('Profile saved')).toBeInTheDocument();
  });

  it('a changed email asks for the current password and sends it', async () => {
    updateProfile.mockResolvedValue({ ...ME, email: 'new@shop.com' });
    renderAt();
    await waitFor(() => expect(screen.getByLabelText('Phone')).toHaveValue('+233245550182'));
    const save = screen.getByRole('button', { name: 'Save profile' });
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
    const email = screen.getByLabelText('Email');
    await userEvent.clear(email);
    await userEvent.type(email, 'new@shop.com');
    expect(save).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Current password'), 'Secret#123');
    await userEvent.click(save);
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({ email: 'new@shop.com', currentPassword: 'Secret#123' })));
  });

  it('a server error shows under the form and nothing changes in the header', async () => {
    updateProfile.mockRejectedValue({ response: { data: { message: 'This email is already in use' } } });
    renderAt();
    await waitFor(() => expect(screen.getByLabelText('Phone')).toHaveValue('+233245550182'));
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This email is already in use');
    expect(useAuthStore.getState().user?.firstName).toBe('Ama');
  });
});
