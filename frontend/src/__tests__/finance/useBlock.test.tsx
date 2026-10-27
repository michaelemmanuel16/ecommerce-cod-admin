import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { clearBlockCache, refreshBlocks, useBlock } from '../../pages/financial/profit/useBlock';
import { useAuthStore } from '../../stores/authStore';

const load = vi.fn();
function Probe({ k, label }: { k: string; label: string }) {
  const b = useBlock(k, () => load(k));
  return <button onClick={b.retry}>{label}:{b.status}:{String(b.data ?? '')}</button>;
}

beforeEach(() => { clearBlockCache(); load.mockReset(); load.mockImplementation(async (k: string) => `${k}!`); });

describe('useBlock shared cache (M5-T40 review)', () => {
  it('two blocks with the same key share one call; a new key asks again', async () => {
    const { rerender } = render(<><Probe k="a" label="x" /><Probe k="a" label="y" /></>);
    expect(await screen.findByText('x:ready:a!')).toBeInTheDocument();
    expect(screen.getByText('y:ready:a!')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    rerender(<><Probe k="b" label="x" /><Probe k="a" label="y" /></>);
    expect(await screen.findByText('x:ready:b!')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a screen opened again within a minute reuses the answer, and Retry asks again', async () => {
    const first = render(<Probe k="a" label="x" />);
    await screen.findByText('x:ready:a!');
    first.unmount();
    render(<Probe k="a" label="x" />);
    await screen.findByText('x:ready:a!');
    expect(load).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });

  it('a failed call is failed, is not cached, and Retry recovers', async () => {
    load.mockRejectedValueOnce(new Error('boom'));
    render(<Probe k="a" label="x" />);
    expect(await screen.findByText('x:failed:')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('x:ready:a!')).toBeInTheDocument();
  });

  it('signing out forgets the cached answers, so the next person to sign in asks again', async () => {
    const first = render(<Probe k="a" label="x" />);
    await screen.findByText('x:ready:a!');
    first.unmount();
    useAuthStore.getState().logout(false);
    render(<Probe k="a" label="x" />);
    await screen.findByText('x:ready:a!');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('refreshBlocks forgets the cache and every block on screen asks again, once per key (M5 UI fix 1)', async () => {
    let n = 0;
    load.mockImplementation(async () => `v${++n}`);
    render(<><Probe k="a" label="x" /><Probe k="a" label="y" /><Probe k="b" label="z" /></>);
    await screen.findByText('x:ready:v1');
    await screen.findByText('z:ready:v2');
    act(() => refreshBlocks());
    expect(await screen.findByText('x:ready:v3')).toBeInTheDocument();
    expect(await screen.findByText('y:ready:v3')).toBeInTheDocument();
    expect(await screen.findByText('z:ready:v4')).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('a block that is not enabled asks for nothing (M5 UI fix 2)', async () => {
    function Off() {
      const b = useBlock('off', () => load('off'), false);
      return <p>off:{b.status}</p>;
    }
    render(<Off />);
    expect(await screen.findByText('off:loading')).toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });
});
