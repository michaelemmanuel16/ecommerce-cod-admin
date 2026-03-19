import crypto from 'crypto';
import logger from './logger';

const SENSITIVE_FIELDS: Record<string, string[]> = {
  whatsappProvider: ['accessToken', 'appSecret', 'webhookVerifyToken'],
  smsProvider: ['authToken'],
  emailProvider: ['apiKey'],
};

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const PREFIX = 'enc:v1:';

let keyWarningLogged = false;

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.PROVIDER_ENCRYPTION_KEY;
  if (!keyHex) {
    if (!keyWarningLogged) {
      logger.warn('PROVIDER_ENCRYPTION_KEY not set — provider credentials stored in plaintext');
      keyWarningLogged = true;
    }
    return null;
  }
  if (keyHex.length !== 64) {
    throw new Error('PROVIDER_ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

function encryptValue(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptValue(value: string, key: Buffer): string {
  const withoutPrefix = value.slice(PREFIX.length);
  const [ivHex, authTagHex, ciphertextHex] = withoutPrefix.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Encrypt sensitive fields in a provider config object.
 * No-op if PROVIDER_ENCRYPTION_KEY is not set.
 */
export function encryptProviderSecrets(providerType: string, provider: any): any {
  if (!provider) return provider;
  const key = getEncryptionKey();
  if (!key) return provider;

  const fields = SENSITIVE_FIELDS[providerType];
  if (!fields) return provider;

  const result = { ...provider };
  for (const field of fields) {
    if (result[field] && typeof result[field] === 'string' && !isEncrypted(result[field])) {
      result[field] = encryptValue(result[field], key);
    }
  }
  return result;
}

/**
 * Decrypt sensitive fields in a provider config object.
 * Plaintext values pass through unchanged (backward compatibility).
 */
export function decryptProviderSecrets(providerType: string, provider: any): any {
  if (!provider) return provider;

  const fields = SENSITIVE_FIELDS[providerType];
  if (!fields) return provider;

  const result = { ...provider };
  for (const field of fields) {
    if (isEncrypted(result[field])) {
      const key = getEncryptionKey();
      if (!key) {
        throw new Error(`Cannot decrypt ${providerType}.${field} — PROVIDER_ENCRYPTION_KEY not set`);
      }
      result[field] = decryptValue(result[field], key);
    }
  }
  return result;
}
