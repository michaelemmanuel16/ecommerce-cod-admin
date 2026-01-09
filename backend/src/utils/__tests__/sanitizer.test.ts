import { describe, it, expect } from '@jest/globals';
import { escapeHtml, sanitizeString, sanitizePhoneNumber, sanitizeAddress, sanitizeName, sanitizeEmail } from '../sanitizer';

describe('Sanitizer Utilities', () => {
    describe('escapeHtml', () => {
        it('escapes standard HTML special characters', () => {
            expect(escapeHtml('<script>alert("XSS")</script>')).toBe('&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;');
            expect(escapeHtml('Click & Win')).toBe('Click &amp; Win');
            expect(escapeHtml("O'Brien")).toBe('O&#x27;Brien');
        });

        it('returns string representation for non-string input', () => {
            expect(escapeHtml(123 as any)).toBe('123');
            expect(escapeHtml(null as any)).toBe('null');
        });
    });

    describe('sanitizeString', () => {
        it('trims and escapes HTML', () => {
            expect(sanitizeString('  <test>  ')).toBe('&lt;test&gt;');
        });

        it('enforces maxLength', () => {
            expect(sanitizeString('abcdef', 3)).toBe('abc');
        });

        it('handles null/undefined', () => {
            expect(sanitizeString(null)).toBe('');
            expect(sanitizeString(undefined)).toBe('');
        });
    });

    describe('sanitizePhoneNumber', () => {
        it('allows only valid phone characters', () => {
            expect(sanitizePhoneNumber('+1-234 (567) 8901 abc')).toBe('+1-234 (567) 8901');
        });

        it('enforces maxLength', () => {
            expect(sanitizePhoneNumber('+1234567890', 5)).toBe('+1234');
        });

        it('trims input', () => {
            expect(sanitizePhoneNumber('  +123  ')).toBe('+123');
        });
    });

    describe('sanitizeAddress', () => {
        it('trims, escapes and enforces length', () => {
            const longAddress = 'A'.repeat(600);
            const sanitized = sanitizeAddress(longAddress, 500);
            expect(sanitized.length).toBe(500);
        });
    });

    describe('sanitizeName', () => {
        it('allows international characters', () => {
            // Arabic: محمد
            expect(sanitizeName('محمد')).toBe('محمد');
            // Cyrillic: Иван
            expect(sanitizeName('Иван')).toBe('Иван');
            // Greek: Αλέξανδρος
            expect(sanitizeName('Αλέξανδρος')).toBe('Αλέξανδρος');
            // Latin with accents
            expect(sanitizeName('María-José')).toBe('María-José');
        });

        it('strips dangerous characters but keeps allowed ones', () => {
            expect(sanitizeName('John <script> Doe')).toBe('John script Doe');
            expect(sanitizeName("O'Brien-Smith Jr.")).toBe("O&#x27;Brien-Smith Jr.");
        });

        it('enforces maxLength', () => {
            expect(sanitizeName('Michael Jordan', 7)).toBe('Michael');
        });
    });

    describe('sanitizeEmail', () => {
        it('validates and lowercases valid emails', () => {
            expect(sanitizeEmail(' Test@Example.com ')).toBe('test@example.com');
        });

        it('returns empty string for invalid emails', () => {
            expect(sanitizeEmail('invalid-email')).toBe('');
            expect(sanitizeEmail('no@domain')).toBe('');
        });
    });
});
