import { Request, Response, NextFunction } from 'express';
import { safeEqual } from '../utils/crypto';

/**
 * Guard for internal endpoints: the request must carry the shared secret held in
 * process.env[envVar] in the given header. With the env var unset it always answers 401.
 */
export const requireSharedSecret = (envVar: string, header: string) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const expected = process.env[envVar];
    const given = req.headers[header];
    if (expected && typeof given === 'string') {
      if (safeEqual(given, expected)) {
        next();
        return;
      }
    }
    res.status(401).json({ error: 'Unauthorized' });
  };
