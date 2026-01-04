import rateLimit from 'express-rate-limit';

const isDevelopment = process.env.NODE_ENV === 'development';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 1000 : 100,
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 10000 : 200,
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

export const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 1000 : 100,
  message: 'Too many webhook requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

export const healthLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute (prevent health check DoS)
  message: 'Too many health check requests',
  standardHeaders: true,
  legacyHeaders: false
});

// Prevent brute force order tracking lookups (very restrictive)
export const publicOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 1000 : 30, // Very restrictive in production
  message: 'Too many order tracking attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});
