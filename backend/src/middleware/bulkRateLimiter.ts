import rateLimit from 'express-rate-limit';
import { BULK_ORDER_CONFIG } from '../config/bulkOrderConfig';

/**
 * Rate limiter for bulk order operations
 * Prevents abuse and resource exhaustion from bulk import/export endpoints
 */
export const bulkOrderRateLimiter = rateLimit({
    windowMs: BULK_ORDER_CONFIG.RATE_LIMIT.EXPORT.WINDOW_MS,
    max: BULK_ORDER_CONFIG.RATE_LIMIT.EXPORT.MAX_REQUESTS,
    message: `Too many bulk requests from this IP, please try again after ${BULK_ORDER_CONFIG.RATE_LIMIT.EXPORT.WINDOW_MS / 60000} minutes`,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    handler: (_req, res) => {
        res.status(429).json({
            message: 'Too many bulk operation requests. Please try again later.',
            retryAfter: `${BULK_ORDER_CONFIG.RATE_LIMIT.EXPORT.WINDOW_MS / 60000} minutes`
        });
    }
});

/**
 * Stricter rate limiter for bulk imports (more resource-intensive)
 */
export const bulkImportRateLimiter = rateLimit({
    windowMs: BULK_ORDER_CONFIG.RATE_LIMIT.IMPORT.WINDOW_MS,
    max: BULK_ORDER_CONFIG.RATE_LIMIT.IMPORT.MAX_REQUESTS,
    message: `Too many bulk import requests from this IP, please try again after ${BULK_ORDER_CONFIG.RATE_LIMIT.IMPORT.WINDOW_MS / 60000} minutes`,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
        res.status(429).json({
            message: 'Bulk import limit exceeded. Please wait before uploading again.',
            retryAfter: `${BULK_ORDER_CONFIG.RATE_LIMIT.IMPORT.WINDOW_MS / 60000} minutes`
        });
    }
});

