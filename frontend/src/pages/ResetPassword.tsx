import React from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Check, Circle } from 'lucide-react';
import { authService } from '../services/auth.service';
import { Button, Input } from '../components/ui-v2';
import { AuthLayout } from '../components/auth/AuthLayout';

// F-121: at least 8 characters with upper case, lower case, a digit and a special character.
const RULES = [
  { id: 'len', text: 'At least 8 characters', test: (v: string) => v.length >= 8 },
  { id: 'upper', text: 'One upper case letter', test: (v: string) => /[A-Z]/.test(v) },
  { id: 'lower', text: 'One lower case letter', test: (v: string) => /[a-z]/.test(v) },
  { id: 'digit', text: 'One number', test: (v: string) => /[0-9]/.test(v) },
  { id: 'special', text: 'One special character', test: (v: string) => /[!@#$%^&*(),.?":{}|<>]/.test(v) },
];

const EXPIRED_LINK = 'This reset link has expired or was already used.';

export const ResetPassword: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');
  const [expired, setExpired] = React.useState(false);

  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [errors, setErrors] = React.useState<{ password?: string; confirm?: string }>({});

  if (!token || expired) {
    return (
      <AuthLayout title="Link not valid">
        <div className="authnote bad" role="alert" style={{ marginTop: 20 }}>{EXPIRED_LINK}</div>
        <p className="authfoot"><Link to="/forgot-password">Request a new reset link</Link></p>
      </AuthLayout>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    const next = {
      password: RULES.every((r) => r.test(password)) ? undefined : 'The password does not meet the rules below',
      confirm: password === confirm ? undefined : 'Passwords do not match',
    };
    setErrors(next);
    if (next.password || next.confirm) return;
    setIsLoading(true);
    try {
      await authService.resetPassword(token, password);
      navigate('/login', { state: { message: 'Password changed. Sign in with your new password.' } });
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      // 400 from the API means the token is unknown, expired or used.
      if (status === 400) setExpired(true);
      else setErrorMessage('Something went wrong. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout title="Set a new password">
      <form onSubmit={onSubmit} noValidate>
        {errorMessage && <div className="authnote bad" role="alert">{errorMessage}</div>}
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          placeholder="Enter new password"
        />
        <ul className="rules" aria-label="Password rules">
          {RULES.map((r) => {
            const met = r.test(password);
            return (
              <li key={r.id} className={met ? 'met' : undefined}>
                {met ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
                {r.text}
              </li>
            );
          })}
        </ul>
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
          placeholder="Confirm new password"
        />
        <Button type="submit" variant="primary" disabled={isLoading}>
          {isLoading ? 'Saving…' : 'Reset password'}
        </Button>
      </form>
      <p className="authfoot"><Link to="/login">Back to sign in</Link></p>
    </AuthLayout>
  );
};
