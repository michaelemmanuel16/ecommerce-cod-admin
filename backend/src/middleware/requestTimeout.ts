import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

/**
 * Request timeout middleware.
 * @param ms - Timeout in milliseconds (default: 30000)
 */
export const requestTimeout = (ms = 30000) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn(`Request timeout after ${ms}ms: ${req.method} ${req.path}`);
        res.status(408).json({ error: 'Request timeout' });
      }
    }, ms);

    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
};
