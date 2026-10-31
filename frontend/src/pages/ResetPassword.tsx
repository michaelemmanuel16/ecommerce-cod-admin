import React from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { authService } from '../services/auth.service';
import { Button } from '../components/ui-v2';
import { AuthLayout } from '../components/auth/AuthLayout';
import { validateNewPassword, type NewPasswordErrors } from '../lib/passwordRules';
import { NewPasswordFields } from '../components/auth/NewPasswordFields';

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
  const [errors, setErrors] = React.useState<NewPasswordErrors>({});

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
    const next = validateNewPassword(password, confirm);
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
        <NewPasswordFields
          password={password}
          confirm={confirm}
          onPasswordChange={setPassword}
          onConfirmChange={setConfirm}
          errors={errors}
        />
        <Button type="submit" variant="primary" disabled={isLoading}>
          {isLoading ? 'Saving…' : 'Reset password'}
        </Button>
      </form>
      <p className="authfoot"><Link to="/login">Back to sign in</Link></p>
    </AuthLayout>
  );
};
