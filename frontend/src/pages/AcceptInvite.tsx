import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/ui-v2';
import { AuthLayout } from '../components/auth/AuthLayout';
import { NewPasswordFields } from '../components/auth/NewPasswordFields';
import { validateNewPassword, type NewPasswordErrors } from '../lib/passwordRules';

// M6-T06 (F-1158): the public page behind an invite link. Set a password, then straight into the app.

/** Shown for a link with no token, and when the API gives no text of its own. */
const LINK_NOT_VALID = 'This invite link is not valid. Ask for a new invite.';

export const AcceptInvite: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { acceptInvite, isLoading } = useAuthStore();

  const [errorMessage, setErrorMessage] = React.useState('');
  // The API's own text once it says the link is dead (expired: 410; unknown or used: 400).
  const [deadMessage, setDeadMessage] = React.useState<string | null>(null);

  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [errors, setErrors] = React.useState<NewPasswordErrors>({});

  if (!token || deadMessage) {
    return (
      <AuthLayout title="Link not valid">
        <div className="authnote bad" role="alert" style={{ marginTop: 20 }}>{deadMessage ?? LINK_NOT_VALID}</div>
      </AuthLayout>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    const next = validateNewPassword(password, confirm);
    setErrors(next);
    if (next.password || next.confirm) return;
    try {
      await acceptInvite(token, password);
      navigate('/');
    } catch (error) {
      const response = (error as { response?: { status?: number; data?: { message?: string } } })?.response;
      const status = response?.status;
      if (status === 410 || status === 400) setDeadMessage(response?.data?.message ?? LINK_NOT_VALID);
      else if (status === 429) setErrorMessage('Too many attempts. Wait a few minutes and try again.');
      else setErrorMessage('Something went wrong. Try again.');
    }
  };

  return (
    <AuthLayout title="Choose your password" subtitle="You were invited to join the team. Set a password to get started.">
      <form onSubmit={onSubmit} noValidate>
        {errorMessage && <div className="authnote bad" role="alert">{errorMessage}</div>}
        <NewPasswordFields
          password={password}
          confirm={confirm}
          onPasswordChange={setPassword}
          onConfirmChange={setConfirm}
          errors={errors}
          passwordLabel="Password"
          passwordPlaceholder="Choose a password"
          confirmPlaceholder="Confirm your password"
        />
        <Button type="submit" variant="primary" disabled={isLoading}>
          {isLoading ? 'Saving…' : 'Set password and continue'}
        </Button>
      </form>
    </AuthLayout>
  );
};
