/**
 * Extended sanitizer tests for branch coverage
 * Covers null/undefined branches not in main test file
 */
import { describe, it, expect } from '@jest/globals';
import { sanitizePhoneNumber, sanitizeAddress, sanitizeName, sanitizeString } from '../sanitizer';

describe('Sanitizer (extended branch coverage)', () => {
  describe('sanitizePhoneNumber - null/undefined inputs', () => {
    it('returns empty string for null input', () => {
      expect(sanitizePhoneNumber(null)).toBe('');
    });

    it('returns empty string for undefined input', () => {
      expect(sanitizePhoneNumber(undefined)).toBe('');
    });

    it('returns empty string for empty string input', () => {
      expect(sanitizePhoneNumber('')).toBe('');
    });
  });

  describe('sanitizeAddress - null/undefined inputs', () => {
    it('returns empty string for null input', () => {
      expect(sanitizeAddress(null)).toBe('');
    });

    it('returns empty string for undefined input', () => {
      expect(sanitizeAddress(undefined)).toBe('');
    });
  });

  describe('sanitizeName - null/undefined and no-match branches', () => {
    it('returns empty string for null input', () => {
      expect(sanitizeName(null)).toBe('');
    });

    it('returns empty string for undefined input', () => {
      expect(sanitizeName(undefined)).toBe('');
    });

    it('returns empty string when input has no allowed characters', () => {
      // All characters are outside the allowed pattern (digits only, no letters or punctuation)
      expect(sanitizeName('1234567890')).toBe('');
    });
  });

  describe('sanitizeString - no maxLength branch', () => {
    it('returns full string when no maxLength provided', () => {
      const long = 'Hello World this is a test string';
      expect(sanitizeString(long)).toBe(long);
    });
  });
});
