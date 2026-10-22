import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SecurityTab } from '../../pages/settings/SecurityTab';
import { ToastProvider } from '../../components/ui-v2';
import { useAuthStore } from '../../stores/authStore';

const changePassword = vi.fn();
const listSessions = vi.fn();
const revokeSession = vi.fn();
const revokeOthers = vi.fn();
const exportMyData = vi.fn();
const deleteAccount = vi.fn();
vi.mock('../../services/account.service', () => ({
  accountService: {
    changePassword: (...a: unknown[]) => changePassword(...a),
    listSessions: (...a: unknown[]) => listSessions(...a),
    revokeSession: (...a: unknown[]) => revokeSession(...a),
    revokeOthers: (...a: unknown[]) => revokeOthers(...a),
    exportMyData: (...a: unknown[]) => exportMyData(...a),
  },
}));
vi.mock('../../services/auth.service', () => ({
  authService: { deleteAccount: (...a: unknown[]) => deleteAccount(...a), logout: () => Promise.resolve() },
}));

const NOW = new Date().toISOString();
const HOURS_AGO = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
const SESSIONS = [
  { id: 1, deviceLabel: 'MacBook · Chrome', ip: '102.89.34.12', lastSeenAt: NOW, createdAt: NOW, current: true },
  { id: 2, deviceLabel: 'iPhone · Safari', ip: '154.160.7.88', lastSeenAt: HOURS_AGO, createdAt: HOURS_AGO, current: false },
];

function renderTab() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <ToastProvider>
        <Routes>
          <Route path="/settings" element={<SecurityTab />} />
          <Route path="/login" element={<div>LOGIN PAGE</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const signIn = (role: string) => useAuthStore.setState({ user: { id: 1, role, firstName: 'A', lastName: 'B' } as never, isAuthenticated: true });

beforeEach(() => {
  [changePassword, listSessions, revokeSession, revokeOthers, exportMyData, deleteAccount].forEach((m) => m.mockReset());
  listSessions.mockResolvedValue(SESSIONS);
  signIn('sales_rep');
});

describe('Password (F-1223)', () => {
  it('a sales rep sees the form and changes the password', async () => {
    changePassword.mockResolvedValue(undefined);
    renderTab();
    await userEvent.type(screen.getByLabelText('Current password'), 'Old#Pass1');
    await userEvent.type(screen.getByLabelText('New password'), 'New#Pass2');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'New#Pass2');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(changePassword).toHaveBeenCalledWith('Old#Pass1', 'New#Pass2'));
    expect(await screen.findByText('Password changed. Other devices are signed out.')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.queryByText(/must be requested from your administrator/)).not.toBeInTheDocument();
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
  });

  it('two different new passwords are refused before any request', async () => {
    renderTab();
    await userEvent.type(screen.getByLabelText('Current password'), 'Old#Pass1');
    await userEvent.type(screen.getByLabelText('New password'), 'New#Pass2');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'Other#Pass3');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match');
    expect(changePassword).not.toHaveBeenCalled();
  });

  it('a wrong current password shows the server message', async () => {
    changePassword.mockRejectedValue({ response: { data: { message: 'Current password is incorrect' } } });
    renderTab();
    await userEvent.type(screen.getByLabelText('Current password'), 'Nope#1234');
    await userEvent.type(screen.getByLabelText('New password'), 'New#Pass2');
    await userEvent.type(screen.getByLabelText('Repeat new password'), 'New#Pass2');
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect');
  });
});

describe('Sessions (F-1224)', () => {
  it('lists device and IP only, marks this device, and signs out one other session', async () => {
    revokeSession.mockResolvedValue(undefined);
    renderTab();
    expect(await screen.findByText('MacBook · Chrome')).toBeInTheDocument();
    expect(screen.getByText(/IP 102\.89\.34\.12/)).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText(/2 hours ago/)).toBeInTheDocument();
    // one Sign out button: the current session has none
    const out = screen.getAllByRole('button', { name: 'Sign out' });
    expect(out).toHaveLength(1);
    await userEvent.click(out[0]);
    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith(2));
  });

  it('"Sign out everywhere else" calls the route and reloads the list', async () => {
    revokeOthers.mockResolvedValue(1);
    renderTab();
    await screen.findByText('iPhone · Safari');
    await userEvent.click(screen.getByRole('button', { name: 'Sign out everywhere else' }));
    await waitFor(() => expect(revokeOthers).toHaveBeenCalled());
    expect(await screen.findByText('Signed out of 1 other place')).toBeInTheDocument();
    await waitFor(() => expect(listSessions).toHaveBeenCalledTimes(2));
  });

  it('"Sign out everywhere else" is off when this is the only session', async () => {
    listSessions.mockResolvedValue([SESSIONS[0]]);
    renderTab();
    await screen.findByText('MacBook · Chrome');
    expect(screen.getByRole('button', { name: 'Sign out everywhere else' })).toBeDisabled();
  });
});

describe('Export and delete (F-1225, F-1226)', () => {
  it('every role can export; only the owner sees Delete account', async () => {
    exportMyData.mockResolvedValue(undefined);
    renderTab();
    expect(screen.queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Export my data' }));
    await waitFor(() => expect(exportMyData).toHaveBeenCalled());
  });

  it('Delete everything stays off until DELETE and a password are typed, then sends both', async () => {
    signIn('super_admin');
    deleteAccount.mockResolvedValue({ message: 'ok' });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    const go = screen.getByRole('button', { name: 'Delete everything' });
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Your password'), 'Own#Pass1');
    expect(go).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'delete');
    expect(go).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Type DELETE to confirm'));
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    expect(go).toBeEnabled();
    await userEvent.click(go);
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledWith('Own#Pass1', 'DELETE'));
    expect(await screen.findByText('LOGIN PAGE')).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('a blocked delete shows the server message and keeps the person signed in', async () => {
    signIn('super_admin');
    deleteAccount.mockRejectedValue({ response: { data: { message: 'Cancel your subscription first' } } });
    renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    await userEvent.type(screen.getByLabelText('Your password'), 'Own#Pass1');
    await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await userEvent.click(screen.getByRole('button', { name: 'Delete everything' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cancel your subscription first');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('the text never mentions "both stores" and Cancel closes the box', async () => {
    signIn('super_admin');
    const { container } = renderTab();
    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(container).not.toHaveTextContent(/both stores/i);
    const box = within(container.querySelector('.confirm') as HTMLElement);
    await userEvent.click(box.getByRole('button', { name: 'Cancel' }));
    expect(container.querySelector('.confirm')).toBeNull();
  });
});
