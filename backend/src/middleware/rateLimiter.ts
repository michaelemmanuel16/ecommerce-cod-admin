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

// SECURITY: Never fully disable rate limiting — use higher limits in dev instead of a passthrough.
// This prevents accidental exposure if NODE_ENV is unset in production.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 1000 : 40, // Strict in production (40/15min), relaxed in dev
  message: { message: 'Too many authentication attempts, please try again later' },
  ...commonSettings
});

// SECURITY: Very strict rate limit for tenant registration to prevent abuse.
export const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 100 : 5, // 5 registrations per 15min per IP in production
  message: { message: 'Too many registration attempts, please try again later' },
  ...commonSettings
});

// Change password: 5 failed tries per 15 minutes for each signed-in user (F-1223).
// Not relaxed in dev or test, and a successful change does not use up the budget.
export const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req: any) => `user:${req.user?.id ?? 'anon'}`,
  message: { message: 'Too many password attempts, please try again later' },
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

// Public, unauthenticated lookups: cap each IP at 30 per 15 minutes (very restrictive).
// Each limiter is its own instance, so one endpoint's traffic never uses up another's budget.
const publicLookupLimiter = (message: string) => rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isDevelopment ? 5000 : 30, // Relaxed for development
  message: { message },
  ...commonSettings
});

// Prevent brute force order tracking lookups
export const publicOrderLimiter = publicLookupLimiter('Too many order tracking attempts. Please try again later.');

// Digital download links are guessable only by token, but a leaked link can be hammered
export const publicDownloadLimiter = publicLookupLimiter('Too many download attempts. Please try again later.');

// The payment callback page asks every 5 seconds while a payment is pending, so this one is not the order-tracking limiter:
// its own budget of 30 per 15 minutes per IP (F-403).
export const publicVerifyLimiter = publicLookupLimiter('Too many payment checks. Please try again in a few minutes.');
