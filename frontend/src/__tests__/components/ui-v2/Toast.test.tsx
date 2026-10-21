import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { Toast, ToastProvider, useToast } from '../../../components/ui-v2';

function Say({ text }: { text: string }) {
  const say = useToast();
  return <button type="button" onClick={() => say(text)}>say</button>;
}

afterEach(() => vi.useRealTimers());

describe('ui-v2 Toast', () => {
  it('renders the pill as a status', () => {
    render(<Toast message="Saved" />);
    expect(screen.getByRole('status')).toHaveClass('sx-toast');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
  it('shows a toast from useToast and hides it after 2800 ms', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Say text="Order saved" /></ToastProvider>);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => screen.getByText('say').click());
    expect(screen.getByRole('status')).toHaveTextContent('Order saved');
    act(() => { vi.advanceTimersByTime(2799); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2); });
    expect(screen.queryByRole('status')).toBeNull();
  });
  it('a new toast replaces the old one and restarts the timer', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Say text="First" /></ToastProvider>);
    act(() => screen.getByText('say').click());
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => screen.getByText('say').click());
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
  it('useToast outside a provider throws a clear error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Say text="x" />)).toThrow('useToast needs a ToastProvider');
    spy.mockRestore();
  });
});
