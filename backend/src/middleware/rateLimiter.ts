import rateLimit from 'express-rate-limit';

const isDevelopment = !process.env.NODE_ENV || process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
const trustProxy = process.env.NODE_ENV === 'production';

const commonSettings = {
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    trustProxy,
    xForwardedForHeader: false
  }
};

export const authLimiter = isDevelopment ? (_req: any, _res: any, next: any) => next() : rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { message: 'Too many authentication attempts, please try again later' },
  ...commonSettings
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 50000 : 200, // Significantly increased for development
  message: { message: 'Too many requests, please try again later' },
  ...commonSettings
});

export const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 10000 : 100,
  message: { message: 'Too many webhook requests, please try again later' },
  ...commonSettings
});

export const healthLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isDevelopment ? 1000 : 30, // Relaxed for development
  message: { message: 'Too many health check requests' },
  ...commonSettings
});

// Prevent brute force order tracking lookups (very restrictive)
export const publicOrderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 5000 : 30, // Relaxed for development
  message: { message: 'Too many order tracking attempts. Please try again later.' },
  ...commonSettings
});
