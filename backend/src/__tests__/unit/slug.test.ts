/**
 * MAN-89: perStoreBillingEmail is what gives each store a DISTINCT Paystack
 * customer (plus-addressed alias of the owner's one inbox).
 */
import { describe, it, expect } from '@jest/globals';
import { slugify, perStoreBillingEmail } from '../../utils/slug';

describe('slugify', () => {
  it('lowercases, hyphenates, and trims edge hyphens', () => {
    expect(slugify('  Second Shop!! ')).toBe('second-shop');
    expect(slugify('ACME & Co')).toBe('acme-co');
  });
});

describe('perStoreBillingEmail (MAN-89)', () => {
  it('plus-addresses the owner inbox with the store slug', () => {
    expect(perStoreBillingEmail('owner@example.com', 'acme')).toBe('owner+store-acme@example.com');
  });

  it('strips an existing +tag so stores never stack tags', () => {
    expect(perStoreBillingEmail('owner+store-old@example.com', 'acme')).toBe('owner+store-acme@example.com');
  });

  it('yields a DISTINCT email per store off the same inbox', () => {
    const a = perStoreBillingEmail('owner@example.com', 'store-a');
    const b = perStoreBillingEmail('owner@example.com', 'store-b');
    expect(a).not.toBe(b);
  });

  it('leaves a non-addressable string unchanged', () => {
    expect(perStoreBillingEmail('not-an-email', 'acme')).toBe('not-an-email');
  });
});
