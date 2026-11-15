import crypto from 'crypto';
import logger from './logger';

/**
 * The canonical map of which provider-config fields are secrets. Exported so
 * adminService can mask/unmask through one source of truth instead of
 * hand-listing per field. When a new integration adds a secret, update this
 * map alone and both encryption AND masking pick it up.
 */
export const SENSITIVE_FIELDS: Record<string, string[]> = {
  whatsappProvider: ['accessToken', 'appSecret', 'webhookVerifyToken'],
  smsProvider: ['authToken'],
  emailProvider: ['apiKey'],
  paystackProvider: ['secretKey'],
};

/** A saved provider is on unless `isEnabled` is explicitly false (configs saved before the toggle have no field). */
export const isProviderEnabled = (provider: { isEnabled?: boolean }): boolean => provider.isEnabled !== false;

/** Sentinel returned to the client in place of a real secret. */
export const SECRET_MASK = '••••••••';

/**
 * Replace every secret field in a provider config with the sentinel.
 * Mutates a shallow copy; original input is untouched.
 */
export function maskProviderSecrets(providerType: string, provider: any): any {
  if (!provider) return provider;
  const fields = SENSITIVE_FIELDS[providerType];
  if (!fields) return provider;
  const masked = { ...provider };
  for (const field of fields) {
    if (masked[field]) masked[field] = SECRET_MASK;
  }
  return masked;
}

/**
 * Replace sentinel values in an incoming provider config with the values from
 * the existing stored config, so saving with the masked placeholder visible
 * doesn't nuke the real secret.
 */
export function preserveMaskedSecrets(providerType: string, incoming: any, existing: any): any {
  if (!incoming) return incoming;
  const fields = SENSITIVE_FIELDS[providerType];
  if (!fields) return incoming;
  const prev = existing || {};
  const result = { ...incoming };
  for (const field of fields) {
    if (result[field] === SECRET_MASK) result[field] = prev[field];
  }
  return result;
}

/** Fields that decide WHERE a provider's secret is sent. Changing one needs the secret typed again, so a masked secret never travels to a new host. */
export const ENDPOINT_FIELDS: Record<string, string[]> = {
  whatsappProvider: ['phoneNumberId', 'businessAccountId', 'wabaId', 'baseUrl', 'apiUrl', 'apiBaseUrl'],
  smsProvider: ['provider', 'baseUrl', 'apiUrl', 'apiBaseUrl', 'endpoint'],
  // fromEmail is the SMTP login when smtpUser is empty, so it decides where the password is used too
  emailProvider: ['provider', 'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'fromEmail', 'baseUrl', 'apiUrl'],
};

/** What an omitted field means once stored, so leaving it out cannot hide a change. The save keeps the stored WhatsApp wabaId when it is left out. */
const DEFAULTS: Record<string, string> = { smtpPort: '587', smtpSecure: 'false' };
const norm = (f: string, v: unknown): string => (v === undefined || v === null || v === '' ? DEFAULTS[f] ?? '' : String(v).trim().toLowerCase());

/**
 * True when the config that will be stored points a secret somewhere else than the stored one. A field left out counts as
 * empty (the save replaces the whole config), so omitting smtpHost is a change. One list, used by the save and the SMTP test.
 */
export function endpointChanged(providerType: string, incoming: any, existing: any): boolean {
  const fields = ENDPOINT_FIELDS[providerType];
  if (!fields || !incoming || !existing) return false;
  return fields.some((f) => {
    if (providerType === 'whatsappProvider' && f === 'wabaId' && incoming[f] === undefined) return false;
    return norm(f, incoming[f]) !== norm(f, existing[f]);
  });
}

/** After an endpoint change, a secret that is still the mask (or empty) while one is stored is refused: the caller must type it again. */
export function secretKeptAcrossEndpointChange(providerType: string, incoming: any, existing: any): boolean {
  if (!endpointChanged(providerType, incoming, existing)) return false;
  // Only the secrets that are sent out to the provider; the app secret and verify token only check what comes in
  const outbound: Record<string, string[]> = { whatsappProvider: ['accessToken'], smsProvider: ['authToken'], emailProvider: ['apiKey'] };
  return (outbound[providerType] ?? []).some((f) => existing[f] && (!incoming[f] || incoming[f] === SECRET_MASK));
}

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
 * Encrypt a single secret string (e.g. a checkout form's Meta CAPI token),
 * using the same AES-256-GCM scheme as the provider-config secrets. Returns the
 * input unchanged when there's no key, the value is empty, or it's already
 * encrypted — so callers can pass it through on every save idempotently.
 */
export function encryptString(value: string | null | undefined): string | null | undefined {
  if (!value || isEncrypted(value)) return value;
  const key = getEncryptionKey();
  if (!key) return value;
  return encryptValue(value, key);
}

/**
 * Decrypt a single secret string encrypted by {@link encryptString}. Plaintext
 * (legacy) values pass through unchanged for backward compatibility.
 */
export function decryptString(value: string | null | undefined): string | null | undefined {
  if (!value || !isEncrypted(value)) return value;
  const key = getEncryptionKey();
  if (!key) throw new Error('Cannot decrypt value — PROVIDER_ENCRYPTION_KEY not set');
  return decryptValue(value, key);
}

/** True when a value carries the {@link PREFIX} encryption marker. */
export function isEncryptedString(value: unknown): boolean {
  return isEncrypted(value);
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
