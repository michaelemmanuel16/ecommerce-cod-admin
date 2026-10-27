import crypto from 'crypto';

// Enforce environment variables - no defaults for security
if (!process.env.WEBHOOK_SECRET) {
  throw new Error('WEBHOOK_SECRET environment variable is required');
}

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

export const generateSignature = (payload: string): string => {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
};

/**
 * Constant-time string compare. Both sides are hashed first so a length mismatch
 * returns false instead of throwing (and leaks nothing about the length).
 */
export const safeEqual = (a: string, b: string): boolean =>
  crypto.timingSafeEqual(
    crypto.createHash('sha256').update(a).digest(),
    crypto.createHash('sha256').update(b).digest()
  );

export const verifySignature = (payload: string, signature: string): boolean =>
  safeEqual(signature, generateSignature(payload));

/**
 * SECURITY NOTE: API Key Generation
 *
 * We use crypto.randomBytes() which is cryptographically secure.
 * This is NOT Math.random() - it uses the OS's entropy source.
 *
 * CodeQL may flag this as "insecure randomness" but this is a FALSE POSITIVE.
 * crypto.randomBytes() is the recommended way to generate secure tokens in Node.js.
 *
 * See: https://nodejs.org/api/crypto.html#cryptorandombytessize-callback
 */
export const generateApiKey = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/** Hex SHA-256 of a text (a file fingerprint). */
export const sha256Hex = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');
