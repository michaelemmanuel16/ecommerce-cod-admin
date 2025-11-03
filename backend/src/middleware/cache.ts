import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

interface CacheEntry {
  data: any;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL = 300;

function getCacheKey(req: Request): string {
  const query = JSON.stringify(req.query);
  return req.method + ':' + req.path + ':' + query;
}

export function cacheMiddleware(ttl: number = DEFAULT_TTL) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      return next();
    }

    const cacheKey = getCacheKey(req);
    const cached = cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < ttl * 1000) {
      logger.debug('Cache HIT: ' + cacheKey);
      return res.json(cached.data);
    }

    const originalJson = res.json.bind(res);

    res.json = function (data: any) {
      cache.set(cacheKey, { data, timestamp: Date.now() });
      logger.debug('Cache SET: ' + cacheKey);
      return originalJson(data);
    };

    next();
  };
}

export function clearCache(pattern?: string) {
  if (pattern) {
    const keys = Array.from(cache.keys());
    keys.forEach(key => {
      if (key.includes(pattern)) {
        cache.delete(key);
      }
    });
  } else {
    cache.clear();
  }
}

export default cacheMiddleware;
