import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import { useAuthStore } from '../../../stores/authStore';

const captureException = vi.hoisted(() => vi.fn(() => 'sentry-event-123'));
vi.mock('@sentry/react', () => ({ captureException }));

function Boom({ explode }: { explode: boolean }): JSX.Element {
  if (explode) throw new Error('kaboom');
  return <p>All good</p>;
}

beforeEach(() => {
  captureException.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  useAuthStore.setState({ user: null, homeRoute: null });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('ErrorBoundary page (F-109)', () => {
  it('with no Sentry DSN: shows a local error id and does not call Sentry', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    render(<ErrorBoundary><Boom explode /></ErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    const id = screen.getByText(/Error id:/).querySelector('code')!.textContent!;
    expect(id).toMatch(/^[A-Z0-9]{4,}$/);
    expect(captureException).not.toHaveBeenCalled();
  });

  it('with a Sentry DSN: reports the error and shows the Sentry event id', () => {
    vi.stubEnv('VITE_SENTRY_DSN', 'https://key@sentry.test/1');
    render(<ErrorBoundary><Boom explode /></ErrorBoundary>);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Error id:/).querySelector('code')!.textContent).toBe('sentry-event-123');
  });

  it('Try again renders the children once the problem is gone', async () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    let explode = true;
    const Child = () => <Boom explode={explode} />;
    render(<ErrorBoundary><Child /></ErrorBoundary>);
    explode = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('All good')).toBeInTheDocument();
  });

  it('renders the children when nothing fails', () => {
    render(<ErrorBoundary><Boom explode={false} /></ErrorBoundary>);
    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });
});
