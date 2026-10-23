import React from 'react';
import { z } from 'zod';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { features } from '../config/features';
import { Button, Input } from '../components/ui-v2';
import { AuthLayout } from '../components/auth/AuthLayout';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});

const LOGIN_FAILED = 'Email or password is wrong';

/**
 * One text for every refusal (F-120): an unknown email, a wrong password and a deactivated account look the same.
 * Only a rate limit or a server problem says something else.
 */
function loginErrorText(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  if (status === undefined || status >= 500) return 'Something went wrong. Try again.';
  return LOGIN_FAILED;
}

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isLoading } = useAuthStore();
  const notice = (location.state as { message?: string } | null)?.message;
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [errors, setErrors] = React.useState<{ email?: string; password?: string }>({});
  const [errorMessage, setErrorMessage] = React.useState<string>('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    const parsed = loginSchema.safeParse({ email: email.trim(), password });
    if (!parsed.success) {
      const fields = parsed.error.flatten().fieldErrors;
      setErrors({ email: fields.email?.[0], password: fields.password?.[0] });
      return;
    }
    setErrors({});
    try {
      await login(parsed.data);
      navigate('/');
    } catch (error) {
      setErrorMessage(loginErrorText(error));
    }
  };

  return (
    <AuthLayout title="Sign in" subtitle="Welcome back. Sign in to your store.">
      <form onSubmit={onSubmit} noValidate>
        {notice && <div className="authnote ok" role="status">{notice}</div>}
        {errorMessage && <div className="authnote bad" role="alert">{errorMessage}</div>}
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          placeholder="you@example.com"
        />
        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          placeholder="Enter your password"
        />
        <div className="authlinks">
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <Button type="submit" variant="primary" disabled={isLoading}>
          {isLoading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      {features.saasSignup && (
        <p className="authfoot">
          Don't have an account? <Link to="/pricing">Sign up</Link>
        </p>
      )}
    </AuthLayout>
  );
};
