import React from 'react';

export interface RepLoadStateProps {
  loading?: boolean;
  loadingText?: string;
  error?: string | null;
  onRetry?: () => void;
  errorTestId?: string;
  retryTestId?: string;
  cardStyle?: React.CSSProperties;
  errorStyle?: React.CSSProperties;
}

export const RepLoadState: React.FC<RepLoadStateProps> = ({
  loading,
  loadingText = 'Loading...',
  error,
  onRetry,
  errorTestId,
  retryTestId,
  cardStyle,
  errorStyle,
}) => {
  if (loading) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center', ...cardStyle }}>
        <p>{loadingText}</p>
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="card"
        style={{ padding: 32, textAlign: 'center', ...cardStyle }}
        data-testid={errorTestId}
      >
        <p style={{ color: 'var(--coral)', fontWeight: 600, ...errorStyle }}>{error}</p>
        {onRetry && (
          <button
            type="button"
            className="btn"
            style={{ marginTop: 12 }}
            onClick={onRetry}
            data-testid={retryTestId}
          >
            Try again
          </button>
        )}
      </div>
    );
  }
  return null;
};

export interface RepPageFrameProps {
  id?: string;
  as?: 'section' | 'div';
  className?: string;
  testId?: string;
  ariaLabel?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  headChildren?: React.ReactNode;
  children?: React.ReactNode;
}

export const RepPageFrame: React.FC<RepPageFrameProps> = ({
  id,
  as: Component = 'section',
  className = 'view on',
  testId,
  ariaLabel,
  title,
  subtitle,
  headChildren,
  children,
}) => {
  return (
    <Component className={className} id={id} aria-label={ariaLabel} data-testid={testId}>
      <div className="head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {headChildren}
      </div>
      {children}
    </Component>
  );
};
