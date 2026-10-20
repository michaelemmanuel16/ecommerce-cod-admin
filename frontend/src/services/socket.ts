import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { useNotificationsStore } from '../stores/notificationsStore';
import toast from 'react-hot-toast';
import { normalizeMoney } from '../utils/money';
import { refreshAccessToken, handleSessionExpired } from './tokenRefresh';

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

  socket.on('order:created', (data) => {
    toast.success(`New order received: ${data.orderNumber}`);
    useNotificationsStore.getState().addNotification({
      id: Date.now(), // Use number instead of string
      type: 'order:created',
      title: 'New Order',
      message: `Order ${data.orderNumber} has been created`,
      read: false,
      createdAt: new Date().toISOString(),
      data,
    });
  });

  socket.on('order:updated', (data) => {
    useNotificationsStore.getState().addNotification({
      id: Date.now(), // Use number instead of string
      type: 'order:updated',
      title: 'Order Updated',
      message: `Order ${data.orderNumber} has been updated`,
      read: false,
      createdAt: new Date().toISOString(),
      data,
    });
  });

  socket.on('order:status_changed', (data) => {
    const statusText = data.status.split('_').join(' ');
    toast.success(`Order ${data.orderNumber} status changed to ${statusText}`);
    useNotificationsStore.getState().addNotification({
      id: Date.now(), // Use number instead of string
      type: 'order:status_changed',
      title: 'Status Changed',
      message: `Order ${data.orderNumber} is now ${statusText}`,
      read: false,
      createdAt: new Date().toISOString(),
      data,
    });
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
