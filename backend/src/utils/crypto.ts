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

export const verifySignature = (payload: string, signature: string): boolean => {
  const expectedSignature = generateSignature(payload);
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
};

export const generateApiKey = (): string => {
  return crypto.randomBytes(32).toString('hex');
};
