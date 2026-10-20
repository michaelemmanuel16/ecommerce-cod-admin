import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { useNotificationsStore } from '../stores/notificationsStore';
import toast from 'react-hot-toast';
import { normalizeMoney } from '../utils/money';

// Use relative URLs in production (when served by Nginx), absolute URLs in development
const WS_URL = import.meta.env.VITE_WS_URL === 'relative'
  ? '' // Empty string for relative URLs - will connect to same origin
  : import.meta.env.VITE_WS_URL || 'http://localhost:3000';

// Same base URL as services/api.ts (not imported: api -> authStore -> socket would be a cycle)
const API_URL = import.meta.env.VITE_API_URL === 'relative'
  ? ''
  : import.meta.env.VITE_API_URL || 'http://localhost:3000';

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

  // The server rejects an expired access token with TOKEN_EXPIRED: refresh it and reconnect
  socket.on('connect_error', async (err) => {
    if (err.message !== 'TOKEN_EXPIRED') return;
    try {
      const refreshToken = useAuthStore.getState().refreshToken;
      if (!refreshToken) return;
      const response = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken });
      useAuthStore.getState().setAccessToken(response.data.accessToken);
      socket?.connect();
    } catch (refreshError) {
      console.error('Socket token refresh failed:', refreshError);
    }
  });

  socket.on('connect', () => {
    console.log('Socket connected:', socket?.id);
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });

  socket.on('order:created', (raw) => {
    const data = normalizeMoney(raw);
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

  socket.on('order:updated', (raw) => {
    const data = normalizeMoney(raw);
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

  socket.on('order:status_changed', (raw) => {
    const data = normalizeMoney(raw);
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
