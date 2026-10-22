import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { useAuthStore } from '../../stores/authStore';
import { refreshAccessToken, handleSessionExpired } from '../../services/tokenRefresh';

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

const post = vi.spyOn(axios, 'post') as unknown as ReturnType<typeof vi.fn>;

describe('refreshAccessToken (single in-flight)', () => {
  beforeEach(() => {
    post.mockReset();
    useAuthStore.setState({ accessToken: 'old', refreshToken: 'r1', isAuthenticated: true });
  });

  it('parallel callers share one /refresh call and all get the new token', async () => {
    let resolve!: (v: any) => void;
    post.mockReturnValue(new Promise((r) => { resolve = r; }));
    const calls = [refreshAccessToken(), refreshAccessToken(), refreshAccessToken()];
    resolve({ data: { accessToken: 'new' } });
    await expect(Promise.all(calls)).resolves.toEqual(['new', 'new', 'new']);
    expect(post).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBe('new');
  });

  it('a later refresh makes a new call once the first one settled', async () => {
    post.mockResolvedValue({ data: { accessToken: 'n1' } });
    await refreshAccessToken();
    await refreshAccessToken();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('a failed refresh rejects every waiter, does not log out, and clears the slot', async () => {
    const err = { response: { status: 429 } };
    post.mockRejectedValueOnce(err);
    const calls = [refreshAccessToken(), refreshAccessToken()];
    await expect(calls[0]).rejects.toBe(err);
    await expect(calls[1]).rejects.toBe(err);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    post.mockResolvedValueOnce({ data: { accessToken: 'ok' } });
    await expect(refreshAccessToken()).resolves.toBe('ok');
  });

  it('no refresh token rejects with a 401-shaped error and makes no request', async () => {
    useAuthStore.setState({ refreshToken: null });
    await expect(refreshAccessToken()).rejects.toMatchObject({ response: { status: 401 } });
    expect(post).not.toHaveBeenCalled();
  });

  it('two tabs: the tab that finds a rotated token in storage skips the /refresh call', async () => {
    // A lock that runs callers one after another, like navigator.locks across tabs
    let chain: Promise<unknown> = Promise.resolve();
    const locks = { request: (_name: string, cb: () => Promise<unknown>) => (chain = chain.then(cb, cb)) };
    Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
    try {
      post.mockResolvedValue({ data: { accessToken: 'acc2', refreshToken: 'r2' } });
      // tab 1 refreshes: r1 -> r2, and the store persists it
      await expect(refreshAccessToken()).resolves.toBe('acc2');
      expect(post).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledWith(expect.stringContaining('/api/auth/refresh'), { refreshToken: 'r1' });
      expect(useAuthStore.getState().refreshToken).toBe('r2');

      // tab 2 still holds r1 in memory; storage (shared) holds r2
      useAuthStore.setState({ accessToken: 'stale', refreshToken: 'r1' });
      localStorage.setItem('auth-storage', JSON.stringify({ state: { accessToken: 'acc2', refreshToken: 'r2' }, version: 0 }));
      await expect(refreshAccessToken()).resolves.toBe('acc2');
      expect(post).toHaveBeenCalledTimes(1); // no second call with the old token
      expect(useAuthStore.getState()).toMatchObject({ accessToken: 'acc2', refreshToken: 'r2' });
    } finally {
      delete (navigator as any).locks;
    }
  });

  it('works without navigator.locks and with unreadable storage', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    post.mockResolvedValue({ data: { accessToken: 'n', refreshToken: 'r9' } });
    try {
      await expect(refreshAccessToken()).resolves.toBe('n');
    } finally {
      spy.mockRestore();
    }
    expect(useAuthStore.getState().refreshToken).toBe('r9');
  });

  it('handleSessionExpired logs out', () => {
    handleSessionExpired();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
