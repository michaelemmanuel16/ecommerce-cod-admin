import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AcceptInvite } from '../../pages/AcceptInvite';
import { useAuthStore } from '../../stores/authStore';
import { authService } from '../../services/auth.service';

vi.mock('../../config/features', () => ({ features: { saasSignup: false }, roleAppRoute: () => null }));
vi.mock('../../services/socket', () => ({ connectSocket: vi.fn(), disconnectSocket: vi.fn(), getSocket: vi.fn() }));
vi.mock('../../services/auth.service', () => ({ authService: { acceptInvite: vi.fn(), checkInvite: vi.fn() } }));

const refusal = (status: number, message = 'x') => Object.assign(new Error(message), { response: { status, data: { message } } });
const SIGNED_IN = {
  user: { id: 5, firstName: 'Ama', lastName: 'Mensah', email: 'ama@x.test', role: 'sales_rep' },
  tokens: { accessToken: 'a', refreshToken: 'r' },
  permissions: {},
};

beforeEach(() => {
  vi.mocked(authService.acceptInvite).mockReset();
  vi.mocked(authService.checkInvite).mockReset();
  vi.mocked(authService.checkInvite).mockResolvedValue(undefined);
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
});

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/accept-invite" element={<AcceptInvite />} />
        <Route path="/" element={<p>HOME</p>} />
      </Routes>
    </MemoryRouter>,
  );

async function fill(password: string, confirm: string) {
  const user = userEvent.setup();
  await screen.findByLabelText('Password');
  await user.type(screen.getByLabelText('Password'), password);
  await user.type(screen.getByLabelText('Confirm password'), confirm);
  await user.click(screen.getByRole('button', { name: 'Set password and continue' }));
}

describe('AcceptInvite (M6-T06)', () => {
  it('ticks the password rules as the password grows', async () => {
    renderAt('/accept-invite?token=abc');
    const rules = await screen.findByRole('list', { name: 'Password rules' });
    expect(rules.querySelectorAll('li.met')).toHaveLength(0);
    await userEvent.setup().type(screen.getByLabelText('Password'), 'Abcdef1!');
    expect(rules.querySelectorAll('li.met')).toHaveLength(5);
  });

  it('blocks a weak password and a mismatch without calling the API', async () => {
    renderAt('/accept-invite?token=abc');
    await fill('weak', 'other');
    expect(await screen.findByText('The password does not meet the rules below')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(authService.acceptInvite).not.toHaveBeenCalled();
  });

  it('saves a good password, signs in and goes into the app', async () => {
    vi.mocked(authService.acceptInvite).mockResolvedValue(SIGNED_IN as never);
    renderAt('/accept-invite?token=abc');
    await fill('Abcdef1!', 'Abcdef1!');
    expect(await screen.findByText('HOME')).toBeInTheDocument();
    expect(authService.acceptInvite).toHaveBeenCalledWith('abc', 'Abcdef1!');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('an expired link (410) shows the API text', async () => {
    vi.mocked(authService.acceptInvite).mockRejectedValue(refusal(410, 'This invite link has expired. Ask for a new invite.'));
    renderAt('/accept-invite?token=abc');
    await fill('Abcdef1!', 'Abcdef1!');
    expect(await screen.findByText('This invite link has expired. Ask for a new invite.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('a used or unknown link (400) shows the API text', async () => {
    vi.mocked(authService.acceptInvite).mockRejectedValue(refusal(400, 'This invite link is not valid or was already used. Ask for a new invite.'));
    renderAt('/accept-invite?token=abc');
    await fill('Abcdef1!', 'Abcdef1!');
    expect(await screen.findByText(/not valid or was already used\. Ask for a new invite/)).toBeInTheDocument();
  });

  it('a 400 with no text falls back to the not-valid text', async () => {
    vi.mocked(authService.acceptInvite).mockRejectedValue(Object.assign(new Error('x'), { response: { status: 400, data: {} } }));
    renderAt('/accept-invite?token=abc');
    await fill('Abcdef1!', 'Abcdef1!');
    expect(await screen.findByText('This invite link is not valid. Ask for a new invite.')).toBeInTheDocument();
  });

  it('no token in the link shows the not-valid text at once', () => {
    renderAt('/accept-invite');
    expect(screen.getByText(/Ask for a new invite/)).toBeInTheDocument();
    expect(authService.checkInvite).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });

  it('a server error keeps the form and says to try again', async () => {
    vi.mocked(authService.acceptInvite).mockRejectedValue(refusal(500));
    renderAt('/accept-invite?token=abc');
    await fill('Abcdef1!', 'Abcdef1!');
    expect(await screen.findByText('Something went wrong. Try again.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });

  it('checks the link when the page opens: a used or expired one says so before any password is typed', async () => {
    vi.mocked(authService.checkInvite).mockRejectedValue(refusal(410, 'This invite link has expired. Ask for a new invite.'));
    renderAt('/accept-invite?token=old');
    expect(await screen.findByText('This invite link has expired. Ask for a new invite.')).toBeInTheDocument();
    expect(authService.checkInvite).toHaveBeenCalledWith('old');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(authService.acceptInvite).not.toHaveBeenCalled();
  });

  it('a used link (400) on load shows the one error, with no form', async () => {
    vi.mocked(authService.checkInvite).mockRejectedValue(refusal(400, 'This invite link is not valid or was already used. Ask for a new invite.'));
    renderAt('/accept-invite?token=used');
    expect(await screen.findByText(/already used\. Ask for a new invite/)).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('a good link shows the form after the check; no token never asks the server', async () => {
    renderAt('/accept-invite?token=good');
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    expect(authService.checkInvite).toHaveBeenCalledTimes(1);
  });

  it('a refusal at submit shows ONE error and nothing else (the client raises no toast of its own)', async () => {
    vi.mocked(authService.acceptInvite).mockRejectedValue(refusal(400, 'This invite link is not valid or was already used. Ask for a new invite.'));
    renderAt('/accept-invite?token=abc');
    await fill('Abcdef1!', 'Abcdef1!');
    expect(await screen.findAllByRole('alert')).toHaveLength(1);
    expect(screen.getAllByText(/Ask for a new invite/)).toHaveLength(1);
  });
});
