import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import logger from '../utils/logger';

// Redis client configuration
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: true
});

// Connect to Redis
redis.on('connect', () => {
  logger.info('Redis cache connected');
});

redis.on('error', (err) => {
  logger.error('Redis cache error:', err);
});

// Gracefully connect
redis.connect().catch((err) => {
  logger.error('Failed to connect to Redis:', err);
});

export { redis };

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  keyPrefix?: string;
  excludeQuery?: string[]; // Query params to exclude from cache key
}

/**
 * Cache middleware for GET requests
 * @param options - Cache configuration options
 */
export const cacheMiddleware = (options: CacheOptions = {}) => {
  const { ttl = 300, keyPrefix = 'cache', excludeQuery = [] } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    try {
      // Generate cache key from URL and query params
      const queryParams = { ...req.query };
      excludeQuery.forEach((param) => delete queryParams[param]);

      const queryString = Object.keys(queryParams).length > 0
        ? `?${new URLSearchParams(queryParams as any).toString()}`
        : '';

      const cacheKey = `${keyPrefix}:${req.path}${queryString}`;

      // Try to get from cache
      const cachedData = await redis.get(cacheKey);

      if (cachedData) {
        logger.debug(`Cache hit for key: ${cacheKey}`);
        res.setHeader('X-Cache', 'HIT');
        return res.json(JSON.parse(cachedData));
      }

      logger.debug(`Cache miss for key: ${cacheKey}`);
      res.setHeader('X-Cache', 'MISS');

      // Store original json method
      const originalJson = res.json.bind(res);

      // Override json method to cache response
      res.json = function (body: any) {
        // Cache the response
        redis.setex(cacheKey, ttl, JSON.stringify(body))
          .catch((err) => logger.error('Failed to cache response:', err));

        // Send response
        return originalJson(body);
      };

      next();
    } catch (error) {
      logger.error('Cache middleware error:', error);
      next(); // Continue without cache on error
    }
  };
};

/**
 * Invalidate cache by pattern
 * @param pattern - Redis key pattern (e.g., 'cache:orders:*')
 */
export const invalidateCache = async (pattern: string): Promise<void> => {
  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.info(`Invalidated ${keys.length} cache keys matching pattern: ${pattern}`);
    }
  } catch (error) {
    logger.error('Failed to invalidate cache:', error);
  }
};

/**
 * Clear all cache
 */
export const clearCache = async (): Promise<void> => {
  try {
    await redis.flushdb();
    logger.info('All cache cleared');
  } catch (error) {
    logger.error('Failed to clear cache:', error);
  }
};

/**
 * Get cache statistics
 */
export const getCacheStats = async (): Promise<any> => {
  try {
    const info = await redis.info('stats');
    const keyspace = await redis.info('keyspace');

    return {
      info,
      keyspace,
      connected: redis.status === 'ready'
    };
  } catch (error) {
    logger.error('Failed to get cache stats:', error);
    return null;
  }
};

// Note: Signal handlers removed - shutdown is handled centrally in server.ts
export const getRedisClient = () => redis;
