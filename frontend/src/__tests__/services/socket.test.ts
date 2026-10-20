import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '../../stores/authStore';

const handlers: Record<string, (arg?: any) => any> = {};
const fakeSocket = { on: vi.fn((e: string, h: any) => { handlers[e] = h; }), connect: vi.fn(), off: vi.fn(), disconnect: vi.fn() };
vi.mock('socket.io-client', () => ({ io: vi.fn(() => fakeSocket) }));

const refreshAccessToken = vi.fn();
const handleSessionExpired = vi.fn();
vi.mock('../../services/tokenRefresh', () => ({
  API_URL: 'http://localhost:3000',
  refreshAccessToken: (...a: any[]) => refreshAccessToken(...a),
  handleSessionExpired: (...a: any[]) => handleSessionExpired(...a),
}));

import { connectSocket } from '../../services/socket';

describe('socket connect_error handling', () => {
  beforeEach(() => {
    refreshAccessToken.mockReset();
    handleSessionExpired.mockReset();
    fakeSocket.connect.mockReset();
    useAuthStore.setState({ accessToken: 't', refreshToken: 'r', isAuthenticated: true });
    connectSocket();
  });

  it('TOKEN_EXPIRED: refreshes through the shared path and reconnects, no logout', async () => {
    refreshAccessToken.mockResolvedValue('new');
    await handlers.connect_error(new Error('TOKEN_EXPIRED'));
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
    expect(handleSessionExpired).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('invalid token (Authentication error): also refreshes, never logs out by itself', async () => {
    refreshAccessToken.mockResolvedValue('new');
    await handlers.connect_error(new Error('Authentication error'));
    expect(fakeSocket.connect).toHaveBeenCalledTimes(1);
    expect(handleSessionExpired).not.toHaveBeenCalled();
  });

  it('refresh fails with 401: session ends', async () => {
    refreshAccessToken.mockRejectedValue({ response: { status: 401 } });
    await handlers.connect_error(new Error('TOKEN_EXPIRED'));
    expect(handleSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('refresh fails with 429 or network error: no logout', async () => {
    refreshAccessToken.mockRejectedValue({ response: { status: 429 } });
    await handlers.connect_error(new Error('TOKEN_EXPIRED'));
    expect(handleSessionExpired).not.toHaveBeenCalled();
  });

  it('does not loop: a second rejection before a successful connect does not refresh again', async () => {
    refreshAccessToken.mockResolvedValue('new');
    await handlers.connect_error(new Error('TOKEN_EXPIRED'));
    await handlers.connect_error(new Error('TOKEN_EXPIRED'));
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('other connect errors are ignored', async () => {
    await handlers.connect_error(new Error('xhr poll error'));
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});
