import React, { Component, ErrorInfo, ReactNode } from 'react';
import * as Sentry from '@sentry/react';
import { AlertTriangle } from 'lucide-react';
import { Button, Card, EmptyState } from './ui-v2';
import { useAuthStore } from '../stores/authStore';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  /** Shown to the person so support can find the report. */
  errorId: string | null;
}

/** Short id for a crash that is not sent to Sentry (no DSN). Support asks for it; the console line carries the same id. */
function localErrorId(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

/** Role home for the "Go home" button. Read from the store when pressed: this boundary sits outside the router. */
function homePath(): string {
  const { user, homeRoute } = useAuthStore.getState();
  return user?.isPlatformAdmin ? '/platform' : (homeRoute ?? '/');
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, errorId: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // With a Sentry DSN the report id is Sentry's event id; without one it is a local id.
    const errorId = import.meta.env.VITE_SENTRY_DSN
      ? Sentry.captureException(error, { contexts: { react: { componentStack: errorInfo.componentStack ?? '' } } })
      : localErrorId();
    console.error(`ErrorBoundary caught an error (id ${errorId}):`, error, errorInfo);
    this.setState({ errorInfo, errorId });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, errorId: null });
  };

  handleGoHome = () => {
    window.location.href = homePath();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="v2 authpage">
        <main className="authbox">
          <Card>
            <EmptyState
              icon={<AlertTriangle aria-hidden="true" />}
              title="Something went wrong"
              text="An unexpected error stopped this page. Your data is safe."
              action={
                <div className="authlinks" style={{ justifyContent: 'center' }}>
                  <Button onClick={this.handleReset}>Try again</Button>
                  <Button variant="primary" onClick={this.handleGoHome}>Go to your home page</Button>
                </div>
              }
            />
            {this.state.errorId && (
              <p className="hint" style={{ textAlign: 'center', paddingBottom: 18 }}>
                Error id: <code>{this.state.errorId}</code>. Send it to support if this keeps happening.
              </p>
            )}
            {import.meta.env.DEV && this.state.error && (
              <pre className="hint" style={{ overflow: 'auto', maxHeight: 160, padding: '0 18px 18px' }}>
                {this.state.error.toString()}
              </pre>
            )}
          </Card>
        </main>
      </div>
    );
  }
}

// Hook version for functional components
export const useErrorHandler = () => {
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  return setError;
};
