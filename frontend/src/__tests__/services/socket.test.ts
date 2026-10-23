import { describe, it, expect, vi, beforeEach } from 'vitest';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import { markOwnMoves } from '../../services/ownMoves';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const handlers: Record<string, (arg?: any) => any> = {};
const fakeSocket = { prependAny: vi.fn(), on: vi.fn((e: string, h: any) => { handlers[e] = h; }), connect: vi.fn(), off: vi.fn(), disconnect: vi.fn() };
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

describe('order:status_changed toast', () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: 't', refreshToken: 'r', isAuthenticated: true });
    connectSocket();
    vi.mocked(toast.success).mockClear();
  });

  it('names the order by its id and says it once for a move made elsewhere', () => {
    handlers['order:status_changed']({ orderId: 21515, newStatus: 'confirmed' });
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Order #21515 status changed to confirmed');
  });

  it('stays silent for a move this tab made itself', () => {
    markOwnMoves([21516]);
    handlers['order:status_changed']({ orderId: 21516, newStatus: 'confirmed' });
    expect(toast.success).not.toHaveBeenCalled();
  });
});
