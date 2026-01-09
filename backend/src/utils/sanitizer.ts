/**
 * Input sanitization utilities to prevent XSS and injection attacks
 */

/**
 * Escape HTML special characters to prevent XSS attacks
 * @param input - String to sanitize
 * @returns Sanitized string with HTML entities escaped
 */
export function escapeHtml(input: string): string {
  if (typeof input !== 'string') {
    return String(input);
  }

  const htmlEscapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };

  return input.replace(/[&<>"'/]/g, (char) => htmlEscapeMap[char] || char);
}

/**
 * Sanitize string by removing potentially dangerous characters
 * but preserving valid unicode and common punctuation
 * @param input - String to sanitize
 * @returns Sanitized string
 */
export function sanitizeString(input: string | null | undefined): string {
  if (!input) return '';

  // Convert to string if not already
  const str = String(input).trim();

  // Escape HTML to prevent XSS
  return escapeHtml(str);
}

/**
 * Sanitize phone number - allow only digits, +, -, spaces, and parentheses
 * @param input - Phone number to sanitize
 * @returns Sanitized phone number
 */
export function sanitizePhoneNumber(input: string | null | undefined): string {
  if (!input) return '';

  // Allow only valid phone number characters
  return String(input).replace(/[^0-9+\-\s()]/g, '').trim();
}

/**
 * Sanitize address - escape HTML but preserve valid characters
 * @param input - Address to sanitize
 * @returns Sanitized address
 */
export function sanitizeAddress(input: string | null | undefined): string {
  if (!input) return '';

  return sanitizeString(input);
}

/**
 * Sanitize name - escape HTML, allow letters, spaces, hyphens, apostrophes
 * @param input - Name to sanitize
 * @returns Sanitized name
 */
export function sanitizeName(input: string | null | undefined): string {
  if (!input) return '';

  const str = String(input).trim();

  // Escape HTML entities
  const escaped = escapeHtml(str);

  // Allow letters (including unicode), spaces, hyphens, apostrophes, periods
  // This preserves names like "O'Brien", "Jean-Pierre", "María", "李明"
  return escaped.replace(/[^a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\s\-'.]/g, '').trim();
}

/**
 * Sanitize email address
 * @param input - Email to sanitize
 * @returns Sanitized email (or empty string if invalid)
 */
export function sanitizeEmail(input: string | null | undefined): string {
  if (!input) return '';

  const str = String(input).toLowerCase().trim();

  // Basic email validation pattern
  const emailPattern = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

  return emailPattern.test(str) ? str : '';
}
