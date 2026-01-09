import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for bulk order operations
 * Prevents abuse and resource exhaustion from bulk import/export endpoints
 */
export const bulkOrderRateLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5, // 5 requests per window per IP
    message: 'Too many bulk requests from this IP, please try again after 5 minutes',
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    skipSuccessfulRequests: false, // Count successful requests
    handler: (_req, res) => {
        res.status(429).json({
            message: 'Too many bulk operation requests. Please try again later.',
            retryAfter: '5 minutes'
        });
    }
});

/**
 * Stricter rate limiter for bulk imports (more resource-intensive)
 */
export const bulkImportRateLimiter = rateLimit({
    windowMs: 10 * 60 * 1000, // 10 minutes
    max: 3, // 3 imports per window per IP
    message: 'Too many bulk import requests from this IP, please try again after 10 minutes',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
        res.status(429).json({
            message: 'Bulk import limit exceeded. Please wait before uploading again.',
            retryAfter: '10 minutes'
        });
    }
});
