import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Login } from '../../pages/Login';
import { ForgotPassword } from '../../pages/ForgotPassword';
import { ResetPassword } from '../../pages/ResetPassword';
import { useAuthStore } from '../../stores/authStore';
import { authService } from '../../services/auth.service';

const flags = vi.hoisted(() => ({ saasSignup: false }));
vi.mock('../../config/features', () => ({
  features: flags,
  roleAppRoute: () => null,
}));
vi.mock('../../services/auth.service', () => ({
  authService: { login: vi.fn(), forgotPassword: vi.fn(), resetPassword: vi.fn() },
}));

const refusal = (status: number, message: string) => Object.assign(new Error(message), { response: { status, data: { message } } });

beforeEach(() => {
  vi.mocked(authService.login).mockReset();
  vi.mocked(authService.forgotPassword).mockReset();
  vi.mocked(authService.resetPassword).mockReset();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
  flags.saasSignup = false;
});

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<p>HOME</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function signIn(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('Login (F-120)', () => {
  it('wrong password and unknown email show the same text', async () => {
    renderLogin();
    vi.mocked(authService.login).mockRejectedValueOnce(refusal(401, 'Invalid credentials'));
    await signIn('owner@shop.test', 'WrongPass1!');
    const first = (await screen.findByRole('alert')).textContent;
    expect(first).toBe('Email or password is wrong');

    vi.mocked(authService.login).mockRejectedValueOnce(refusal(401, 'No such user ghost@shop.test'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(authService.login).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole('alert')).textContent).toBe(first);
  });

  it('a deactivated account (403) also shows the generic text', async () => {
    renderLogin();
    vi.mocked(authService.login).mockRejectedValue(refusal(403, 'Account is deactivated'));
    await signIn('off@shop.test', 'Whatever1!');
    expect((await screen.findByRole('alert')).textContent).toBe('Email or password is wrong');
  });

  it('a rate limit and a server error say something else', async () => {
    renderLogin();
    vi.mocked(authService.login).mockRejectedValueOnce(refusal(429, 'Too many'));
    await signIn('a@shop.test', 'Whatever1!');
    expect((await screen.findByRole('alert')).textContent).toMatch(/too many attempts/i);
    vi.mocked(authService.login).mockRejectedValueOnce(refusal(500, 'boom'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/something went wrong/i));
  });

  it('empty fields show field errors and do not call the API', async () => {
    renderLogin();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(authService.login).not.toHaveBeenCalled();
  });

  it('links to forgot password; no sign-up link while SaaS signup is off', () => {
    renderLogin();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');
    expect(screen.queryByRole('link', { name: /sign up/i })).toBeNull();
  });

  it('shows the sign-up link when SaaS signup is on', () => {
    flags.saasSignup = true;
    renderLogin();
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/pricing');
  });
});

describe('Forgot password (F-121)', () => {
  const renderForgot = () => render(<MemoryRouter><ForgotPassword /></MemoryRouter>);

  it('answers with the same text whatever the email', async () => {
    vi.mocked(authService.forgotPassword).mockResolvedValue({ message: 'x' } as never);
    renderForgot();
    await userEvent.setup().type(screen.getByLabelText('Email'), 'ghost@shop.test');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText("If an account exists with that email, we've sent a reset link.")).toBeInTheDocument();
    expect(screen.getByText(/expires in 15 minutes/i)).toBeInTheDocument();
  });

  it('rejects a bad email before calling the API', async () => {
    renderForgot();
    await userEvent.setup().type(screen.getByLabelText('Email'), 'nope');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(authService.forgotPassword).not.toHaveBeenCalled();
  });

  it('shows a plain error when the call fails', async () => {
    vi.mocked(authService.forgotPassword).mockRejectedValue(refusal(500, 'boom'));
    renderForgot();
    await userEvent.setup().type(screen.getByLabelText('Email'), 'a@shop.test');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send reset link' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Something went wrong. Try again.');
  });
});

describe('Reset password (F-121)', () => {
  const renderReset = (url = '/reset-password?token=abc') =>
    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/login" element={<p>LOGIN</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it('shows the password rules and ticks them as the password grows', async () => {
    renderReset();
    const rules = screen.getByRole('list', { name: 'Password rules' });
    expect(rules.querySelectorAll('li.met')).toHaveLength(0);
    await userEvent.setup().type(screen.getByLabelText('New password'), 'Abcdef1!');
    expect(rules.querySelectorAll('li.met')).toHaveLength(5);
  });

  it('blocks a weak password and a mismatch', async () => {
    renderReset();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New password'), 'weak');
    await user.type(screen.getByLabelText('Confirm password'), 'other');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText('The password does not meet the rules below')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(authService.resetPassword).not.toHaveBeenCalled();
  });

  it('saves a good password and goes to sign in', async () => {
    vi.mocked(authService.resetPassword).mockResolvedValue({ message: 'ok' } as never);
    renderReset();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New password'), 'Abcdef1!');
    await user.type(screen.getByLabelText('Confirm password'), 'Abcdef1!');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
    expect(authService.resetPassword).toHaveBeenCalledWith('abc', 'Abcdef1!');
  });

  it('an expired or used token shows the expired text and a link for a new one', async () => {
    vi.mocked(authService.resetPassword).mockRejectedValue(refusal(400, 'Invalid or expired reset token'));
    renderReset();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('New password'), 'Abcdef1!');
    await user.type(screen.getByLabelText('Confirm password'), 'Abcdef1!');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByText('This reset link has expired or was already used.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toHaveAttribute('href', '/forgot-password');
  });

  it('a link with no token shows the same expired text', () => {
    renderReset('/reset-password');
    expect(screen.getByText('This reset link has expired or was already used.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toBeInTheDocument();
  });
});
