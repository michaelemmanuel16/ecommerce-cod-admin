import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { redis } from './cache.middleware';
import prisma from '../utils/prisma';
import logger from '../utils/logger';

/**
 * Per-tenant rate limiting middleware using Redis fixed window counter.
 * Only active when tenant.rateLimitEnabled is true.
 * Applied after authenticate middleware (needs req.user.tenantId).
 */
export const tenantRateLimiter = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tenantId = req.user?.tenantId;
    if (!tenantId) return next(); // No tenant context (platform admin or unauthenticated)

    // Check if rate limiting is enabled for this tenant (cached 60s)
    const cacheKey = `ratelimit:config:${tenantId}`;
    let configStr = await redis.get(cacheKey);

    if (configStr === null) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { rateLimitEnabled: true, rateLimitConfig: true },
      });

      if (!tenant || !tenant.rateLimitEnabled) {
        // Cache the "disabled" state for 60s to avoid DB hit every request
        await redis.setex(cacheKey, 60, JSON.stringify({ enabled: false }));
        return next();
      }

      const config = (tenant.rateLimitConfig as any) || { requestsPer15Min: 5000, burstPerSec: 50 };
      configStr = JSON.stringify({ enabled: true, ...config });
      await redis.setex(cacheKey, 60, configStr);
    }

    const config = JSON.parse(configStr);
    if (!config.enabled) return next();

    const windowMs = 15 * 60 * 1000;
    const maxRequests = config.requestsPer15Min || 5000;
    const windowKey = `ratelimit:tenant:${tenantId}:${Math.floor(Date.now() / windowMs)}`;

    // Atomic INCR + EXPIRE to prevent orphaned keys if process crashes between calls
    const ttl = Math.ceil(windowMs / 1000);
    const pipeline = redis.pipeline();
    pipeline.incr(windowKey);
    pipeline.expire(windowKey, ttl);
    const results = await pipeline.exec();
    const current = (results?.[0]?.[1] as number) || 0;

    const remaining = Math.max(0, maxRequests - current);
    const resetTime = Math.ceil((Math.floor(Date.now() / windowMs) + 1) * windowMs / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetTime);

    if (current > maxRequests) {
      const retryAfter = Math.ceil((resetTime * 1000 - Date.now()) / 1000);
      res.setHeader('Retry-After', retryAfter);
      logger.warn(`Tenant ${tenantId} rate limited: ${current}/${maxRequests}`);
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }

    next();
  } catch (err) {
    // On Redis failure, don't block the request
    logger.error('Tenant rate limiter error:', err);
    next();
  }
};
