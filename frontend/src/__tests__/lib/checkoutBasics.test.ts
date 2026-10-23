import { describe, it, expect } from 'vitest';
import { domainLineErrors, isAllowedDomain, slugFromName, thankYouError, validateBasics } from '../../lib/checkoutBasics';

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

describe('validateBasics', () => {
  const ok = { name: 'Summer sale', slug: 'summer-sale', productId: 3, redirectUrl: '', allowedOrigins: '' };

  it('passes good values', () => {
    expect(validateBasics(ok)).toBeNull();
    expect(validateBasics({ ...ok, redirectUrl: 'https://x.com/t', allowedOrigins: 'shop.example.com' })).toBeNull();
  });

  it.each([
    [{ name: '  ' }, 'Give the form a name.'],
    [{ slug: '' }, 'The form name needs at least one letter or number.'],
    [{ productId: 0 }, 'Choose the product this form sells.'],
    [{ redirectUrl: 'http://x.com' }, 'Thank-you page must start with https://'],
    [{ allowedOrigins: 'ok.example.com\nnope' }, '"nope" is not a valid domain. Use a host such as shop.example.com.'],
  ])('names the first problem: %j', (over, message) => {
    expect(validateBasics({ ...ok, ...over })).toBe(message);
  });

  it('reports the name before anything later', () => {
    expect(validateBasics({ ...ok, name: '', productId: 0, redirectUrl: 'http://x.com' })).toBe('Give the form a name.');
  });
});
