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
 * @param maxLength - Optional maximum length
 * @returns Sanitized string
 */
export function sanitizeString(input: string | null | undefined, maxLength?: number): string {
  if (!input) return '';

  // Convert to string if not already
  let str = String(input).trim();

  // Enforce length limit if provided
  if (maxLength && str.length > maxLength) {
    str = str.substring(0, maxLength);
  }

  // Escape HTML to prevent XSS
  return escapeHtml(str);
}

/**
 * Sanitize phone number - allow only digits, +, -, spaces, and parentheses
 * @param input - Phone number to sanitize
 * @param maxLength - Optional maximum length
 * @returns Sanitized phone number
 */
export function sanitizePhoneNumber(input: string | null | undefined, maxLength?: number): string {
  if (!input) return '';

  let str = String(input).trim();

  // Enforce length limit if provided
  if (maxLength && str.length > maxLength) {
    str = str.substring(0, maxLength);
  }

  // Allow only valid phone number characters
  return str.replace(/[^0-9+\-\s()]/g, '').trim();
}

/**
 * Sanitize address - escape HTML but preserve valid characters
 * @param input - Address to sanitize
 * @param maxLength - Optional maximum length
 * @returns Sanitized address
 */
export function sanitizeAddress(input: string | null | undefined, maxLength?: number): string {
  if (!input) return '';

  return sanitizeString(input, maxLength);
}

/**
 * Sanitize name - allow letters (including many international scripts), spaces, hyphens, apostrophes, periods
 * Strips HTML tags and other non-name characters.
 * @param input - Name to sanitize
 * @param maxLength - Optional maximum length
 * @returns Sanitized name
 */
export function sanitizeName(input: string | null | undefined, maxLength?: number): string {
  if (!input) return '';

  let str = String(input).trim();

  // Enforce length limit if provided
  if (maxLength && str.length > maxLength) {
    str = str.substring(0, maxLength);
  }

  // Strip everything NOT allowed (including <, >, &, etc. which are not in the allowed regex)
  // This effectively removes HTML tags and potential injection vectors for names
  const allowedPattern = /[a-zA-Z\u00C0-\u017F\u0400-\u04FF\u0600-\u06FF\u0370-\u03FF\s\-'.]/g;
  const matches = str.match(allowedPattern);
  const stripped = matches ? matches.join('') : '';

  // Escape HTML entities for the remaining characters (like apostrophes or periods if they were allowed)
  return escapeHtml(stripped).trim();
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

