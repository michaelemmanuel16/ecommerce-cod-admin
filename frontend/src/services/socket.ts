import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../stores/authStore';
import { useNotificationsStore } from '../stores/notificationsStore';
import toast from 'react-hot-toast';

const WS_URL = import.meta.env.VITE_WS_URL || 'http://localhost:3000';

let socket: Socket | null = null;

export const connectSocket = () => {
  const token = useAuthStore.getState().accessToken;
  
  if (!token) {
    console.error('No auth token available');
    return;
  }

  socket = io(WS_URL, {
    auth: {
      token,
    },
  });

  socket.on('connect', () => {
    console.log('Socket connected:', socket?.id);
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected');
  });

  socket.on('order_created', (data) => {
    toast.success(`New order received: ${data.orderNumber}`);
    useNotificationsStore.getState().addNotification({
      id: Date.now().toString(),
      type: 'order_created',
      title: 'New Order',
      message: `Order ${data.orderNumber} has been created`,
      read: false,
      createdAt: new Date().toISOString(),
      data,
    });
  });

  socket.on('order_updated', (data) => {
    useNotificationsStore.getState().addNotification({
      id: Date.now().toString(),
      type: 'order_updated',
      title: 'Order Updated',
      message: `Order ${data.orderNumber} has been updated`,
      read: false,
      createdAt: new Date().toISOString(),
      data,
    });
  });

  socket.on('order_status_changed', (data) => {
    const statusText = data.status.split('_').join(' ');
    toast.success(`Order ${data.orderNumber} status changed to ${statusText}`);
    useNotificationsStore.getState().addNotification({
      id: Date.now().toString(),
      type: 'order_status_changed',
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
