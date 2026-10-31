import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Circle } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { Button, Input } from '../components/ui-v2';
import { AuthLayout } from '../components/auth/AuthLayout';
import { RULES } from '../lib/passwordRules';

// M6-T06 (F-1158): the public page behind an invite link. Set a password, then straight into the app.

const EXPIRED_INVITE = 'This invite link has expired. Ask for a new invite.';
const INVALID_INVITE = 'This invite link is not valid or was already used. Ask for a new invite.';

export const AcceptInvite: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { acceptInvite, isLoading } = useAuthStore();

  const [errorMessage, setErrorMessage] = React.useState('');
  // The link is dead: 'expired' (410) or 'invalid' (400, or no token in the link).
  const [dead, setDead] = React.useState<'expired' | 'invalid' | null>(token ? null : 'invalid');

  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [errors, setErrors] = React.useState<{ password?: string; confirm?: string }>({});

  if (!token || dead) {
    return (
      <AuthLayout title="Link not valid">
        <div className="authnote bad" role="alert" style={{ marginTop: 20 }}>
          {dead === 'expired' ? EXPIRED_INVITE : INVALID_INVITE}
        </div>
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
    try {
      await acceptInvite(token, password);
      navigate('/');
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 410) setDead('expired');
      else if (status === 400) setDead('invalid');
      else if (status === 429) setErrorMessage('Too many attempts. Wait a few minutes and try again.');
      else setErrorMessage('Something went wrong. Try again.');
    }
  };

  return (
    <AuthLayout title="Choose your password" subtitle="You were invited to join the team. Set a password to get started.">
      <form onSubmit={onSubmit} noValidate>
        {errorMessage && <div className="authnote bad" role="alert">{errorMessage}</div>}
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          placeholder="Choose a password"
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
          placeholder="Confirm your password"
        />
        <Button type="submit" variant="primary" disabled={isLoading}>
          {isLoading ? 'Saving…' : 'Set password and continue'}
        </Button>
      </form>
    </AuthLayout>
  );
};
