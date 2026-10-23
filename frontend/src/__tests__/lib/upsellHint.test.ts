import { describe, it, expect } from 'vitest';
import { upsellHint } from '../../lib/upsellHint';
import { isStorageUrl } from '../../lib/storageHost';

describe('upsellHint', () => {
  it('shows nothing under 30 orders', () => {
    expect(upsellHint(29, 20)).toBeNull();
  });
  it('shows a whole percent from 30 orders', () => {
    expect(upsellHint(30, 10)).toBe('33% of buyers also buy this.');
    expect(upsellHint(200, 70)).toBe('35% of buyers also buy this.');
  });
  it('shows nothing for an upsell with no count', () => {
    expect(upsellHint(100, undefined)).toBeNull();
  });
});

describe('isStorageUrl', () => {
  it('accepts https on the storage host only', () => {
    expect(isStorageUrl('https://img.example.com/a.png', 'img.example.com')).toBe(true);
    expect(isStorageUrl('https://evil.example.org/a.png', 'img.example.com')).toBe(false);
    expect(isStorageUrl('http://img.example.com/a.png', 'img.example.com')).toBe(false);
    expect(isStorageUrl('https://img.example.com/a.png', null)).toBe(false);
    expect(isStorageUrl('nonsense', 'img.example.com')).toBe(false);
  });
});
