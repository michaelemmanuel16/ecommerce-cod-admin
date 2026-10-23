import React from 'react';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { authService } from '../services/auth.service';
import { Button, Input } from '../components/ui-v2';
import { AuthLayout } from '../components/auth/AuthLayout';

const emailSchema = z.string().email('Enter a valid email address');

export const ForgotPassword: React.FC = () => {
  const [isSubmitted, setIsSubmitted] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');

  const [email, setEmail] = React.useState('');
  const [emailError, setEmailError] = React.useState('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    const parsed = emailSchema.safeParse(email.trim());
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0].message);
      return;
    }
    setEmailError('');
    setIsLoading(true);
    try {
      await authService.forgotPassword(parsed.data);
      setIsSubmitted(true);
    } catch {
      setErrorMessage('Something went wrong. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthLayout title="Reset your password" subtitle="We will email you a link to set a new one.">
      {isSubmitted ? (
        <div className="authcard-body" style={{ marginTop: 20 }}>
          <div className="authnote ok" role="status">
            If an account exists with that email, we've sent a reset link.
          </div>
          <p className="hint">Check your email and follow the link. The link expires in 15 minutes.</p>
          <p className="authfoot"><Link to="/login">Back to sign in</Link></p>
        </div>
      ) : (
        <>
          <form onSubmit={onSubmit} noValidate>
            {errorMessage && <div className="authnote bad" role="alert">{errorMessage}</div>}
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              error={emailError}
              placeholder="you@example.com"
            />
            <Button type="submit" variant="primary" disabled={isLoading}>
              {isLoading ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>
          <p className="authfoot"><Link to="/login">Back to sign in</Link></p>
        </>
      )}
    </AuthLayout>
  );
};
