/**
 * Global Socket.io Instance
 * This module provides a singleton pattern for accessing the Socket.io server instance
 * across the application, particularly in background workers and queues.
 */

import { Server as SocketServer } from 'socket.io';
import logger from './logger';

let socketInstance: SocketServer | null = null;

/**
 * Set the Socket.io server instance
 * Should be called once during server initialization
 */
export function setSocketInstance(io: SocketServer): void {
  socketInstance = io;
  logger.info('Socket.io instance registered for global access');
}

/**
 * Get the Socket.io server instance
 * Returns null if not yet initialized
 */
export function getSocketInstance(): SocketServer | null {
  if (!socketInstance) {
    logger.warn('Socket.io instance accessed before initialization');
  }
  return socketInstance;
}

/**
 * Check if Socket.io instance is available
 */
export function hasSocketInstance(): boolean {
  return socketInstance !== null;
}
