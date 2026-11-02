import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../services/auth.service';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/ui-v2';
import { AuthLayout } from '../components/auth/AuthLayout';
import { NewPasswordFields } from '../components/auth/NewPasswordFields';
import { apiErrorMessage } from '../utils/apiError';
import { validateNewPassword, type NewPasswordErrors } from '../lib/passwordRules';

// M6-T06 (F-1158): the public page behind an invite link. Set a password, then straight into the app.

/** Shown for a link with no token, and when the API gives no text of its own. */
const LINK_NOT_VALID = 'This invite link is not valid. Ask for a new invite.';

/** The API's own sentence for a dead link, else the plain one. */
const refusalText = (error: unknown): string => apiErrorMessage(error, LINK_NOT_VALID);

export const AcceptInvite: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { acceptInvite, isLoading } = useAuthStore();

  const [errorMessage, setErrorMessage] = React.useState('');
  // The API's own text once it says the link is dead (expired: 410; unknown or used: 400).
  const [deadMessage, setDeadMessage] = React.useState<string | null>(null);
  // The link is checked when the page opens, so a used or expired one says so before a password is typed.
  const [checked, setChecked] = React.useState(false);
  React.useEffect(() => {
    if (!token) return;
    let live = true;
    authService.checkInvite(token).then(
      () => { if (live) setChecked(true); },
      (error) => { if (live) setDeadMessage(refusalText(error)); },
    );
    return () => { live = false; };
  }, [token]);

  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [errors, setErrors] = React.useState<NewPasswordErrors>({});

  if (token && !deadMessage && !checked) {
    return <AuthLayout title="Checking your link"><p className="authfoot" role="status">One moment.</p></AuthLayout>;
  }

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
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 410 || status === 400) setDeadMessage(refusalText(error));
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
