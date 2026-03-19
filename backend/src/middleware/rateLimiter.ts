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
  max: 300,
  message: { message: 'Too many authentication attempts, please try again later' },
  ...commonSettings
});

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 50000 : 500, // Increased to 500 in production
  message: { message: 'Too many requests, please try again later' },
  ...commonSettings
});

export const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 10000 : 100,
  message: { message: 'Too many webhook requests, please try again later' },
  ...commonSettings
});

// Higher limit for WhatsApp webhooks — Meta sends bursts of status callbacks
// (sent/delivered/read per message). 1000/15min handles ~300 messages worth of callbacks.
export const whatsappWebhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDevelopment ? 10000 : 1000,
  message: { message: 'Too many webhook requests' },
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
