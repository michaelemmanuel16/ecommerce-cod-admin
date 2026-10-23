import { describe, it, expect } from 'vitest';
import { domainLineErrors, isAllowedDomain, slugFromName, thankYouError } from '../../lib/checkoutBasics';

describe('thankYouError', () => {
  it('allows empty (the built-in screen shows) and https', () => {
    expect(thankYouError('')).toBeNull();
    expect(thankYouError('   ')).toBeNull();
    expect(thankYouError('https://shop.example.com/thanks')).toBeNull();
  });

  it('refuses http, a bare host and text', () => {
    for (const bad of ['http://shop.example.com', 'shop.example.com', 'thanks']) {
      expect(thankYouError(bad)).toBe('Thank-you page must start with https://');
    }
  });
});

describe('isAllowedDomain (same rule as normalizeAllowedOrigins on the server)', () => {
  it('accepts a host, an https origin and a port', () => {
    for (const ok of ['shop.example.com', 'https://shop.example.com', 'https://shop.example.com/', 'Shop.Example.com:8443']) {
      expect(isAllowedDomain(ok)).toBe(true);
    }
  });

  it('refuses http, paths, wildcards, bare names and spaces', () => {
    for (const bad of ['http://shop.example.com', 'example.com/shop', '*.example.com', 'localhost', 'a b.com', 'https://']) {
      expect(isAllowedDomain(bad)).toBe(false);
    }
  });
});

describe('domainLineErrors', () => {
  it('names each bad line, skips blank lines', () => {
    const errors = domainLineErrors('shop.example.com\n\nhttp://x.com\n  \nexample.com/a');
    expect(errors.map((e) => e.line)).toEqual([3, 5]);
    expect(errors[0].message).toBe('"http://x.com" is not a valid domain. Use a host such as shop.example.com.');
  });
});

describe('slugFromName', () => {
  it('lowercases, joins with hyphens and trims them', () => {
    expect(slugFromName('  Summer Sale 2026!  ')).toBe('summer-sale-2026');
    expect(slugFromName('!!!')).toBe('');
  });
});
