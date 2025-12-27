/**
 * Validation utilities for webhook configuration
 */

/**
 * Validate URL format
 */
export const validateURL = (url: string): boolean => {
  if (!url || url.trim() === '') {
    return false;
  }

  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

/**
 * Validate field mappings
 * Ensures no duplicate internal fields and required fields are present
 */
export const validateMappings = (
  mappings: Array<{ external: string; internal: string }>
): string | null => {
  // Filter out empty mappings
  const validMappings = mappings.filter(m => m.external && m.internal);

  if (validMappings.length === 0) {
    return 'At least one field mapping is required';
  }

  // Check for duplicate internal fields
  const internalFields = validMappings.map(m => m.internal);
  const uniqueInternals = new Set(internalFields);

  if (uniqueInternals.size !== internalFields.length) {
    return 'Each internal field can only be mapped once';
  }

  // Check for required customerPhone mapping
  if (!validMappings.some(m => m.internal === 'customerPhone')) {
    return 'Customer Phone mapping is required';
  }

  return null;
};

/**
 * Validate secret key strength
 */
export const validateSecret = (secret: string): string | null => {
  if (!secret || secret.trim() === '') {
    return 'Secret key is required';
  }

  if (secret.length < 16) {
    return 'Secret key must be at least 16 characters';
  }

  return null;
};

/**
 * Validate webhook name
 */
export const validateName = (name: string): string | null => {
  if (!name || name.trim() === '') {
    return 'Webhook name is required';
  }

  if (name.length < 3) {
    return 'Webhook name must be at least 3 characters';
  }

  if (name.length > 100) {
    return 'Webhook name must be less than 100 characters';
  }

  return null;
};

/**
 * Generate a secure random secret key
 */
export const generateSecret = (length: number = 32): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  let result = '';

  // Use crypto.getRandomValues if available (browser)
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const array = new Uint32Array(length);
    window.crypto.getRandomValues(array);
    for (let i = 0; i < length; i++) {
      result += chars[array[i] % chars.length];
    }
  } else {
    // Fallback for environments without crypto
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
  }

  return result;
};

/**
 * Generate a UUID for API key
 */
export const generateApiKey = (): string => {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  // Fallback UUID v4 generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};
