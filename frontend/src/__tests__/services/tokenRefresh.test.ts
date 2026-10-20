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

  it('handleSessionExpired logs out', () => {
    handleSessionExpired();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
