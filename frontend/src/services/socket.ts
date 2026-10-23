import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';
import { normalizeMoney } from '../utils/money';
import { refreshAccessToken, handleSessionExpired } from './tokenRefresh';
import { isOwnMove } from './ownMoves';

// Use relative URLs in production (when served by Nginx), absolute URLs in development
const WS_URL = import.meta.env.VITE_WS_URL === 'relative'
  ? '' // Empty string for relative URLs - will connect to same origin
  : import.meta.env.VITE_WS_URL || 'http://localhost:3000';

let socket: Socket | null = null;

export const connectSocket = () => {
  const token = useAuthStore.getState().accessToken;

  if (!token) {
    console.error('No auth token available');
    return;
  }

  socket = io(WS_URL, {
    // A function, so every reconnect sends the current access token
    auth: (cb) => cb({ token: useAuthStore.getState().accessToken }),
  });

  // Money arrives as "x.xx" strings. Parse every payload in place before any listener
  // (including financialStore's) sees it.
  socket.prependAny((_event, payload) => normalizeMoney(payload));

  let refreshedAfterReject = false;

  // The server rejects an expired or invalid access token. Ask the shared refresh (the same
  // single in-flight call axios uses) and reconnect. Only a 401 from the refresh itself ends the session.
  socket.on('connect_error', async (err) => {
    if (err.message !== 'TOKEN_EXPIRED' && err.message !== 'Authentication error') return;
    // One refresh-and-reconnect per failed connect: a token that is still refused after a refresh is not a token problem
    if (refreshedAfterReject) return;
    refreshedAfterReject = true;
    try {
      await refreshAccessToken();
      socket?.connect();
    } catch (refreshError: any) {
      console.error('Socket token refresh failed:', refreshError);
      if (refreshError?.response?.status === 401) handleSessionExpired();
    }
  });

  socket.on('connect', () => {
    refreshedAfterReject = false;
    console.log('Socket connected:', socket?.id);
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });

  // The bell's count is read from the database (notificationsStore listens for `notification`), so these
  // order events only raise a toast. They no longer add to an in-memory list.
  socket.on('order:created', (data) => {
    toast.success(`New order received: ${data.orderNumber}`);
  });

  socket.on('order:status_changed', (data) => {
    // A move made in this tab has its own toast
    if (isOwnMove(Number(data.orderId))) return;
    // The server sends `newStatus`; `status` is kept for older payloads.
    const statusText = String(data.newStatus ?? data.status ?? '').split('_').join(' ');
    // Orders are named by their number, as everywhere else
    toast.success(`Order #${data.orderId} status changed to ${statusText}`);
  });

  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

export const getSocket = () => socket;
