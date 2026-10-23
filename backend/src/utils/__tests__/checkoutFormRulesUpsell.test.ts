import { describe, it, expect } from '@jest/globals';
import { isUpsellAvailable } from '../checkoutFormRules';

describe('isUpsellAvailable (F-415)', () => {
  it('a manual upsell shows', () => {
    expect(isUpsellAvailable({ productId: null, product: null })).toBe(true);
  });

  it('an upsell switched off in the editor (items.off) is hidden, linked to a product or not', () => {
    expect(isUpsellAvailable({ productId: null, items: { quantity: 1, off: true } })).toBe(false);
    expect(
      isUpsellAvailable({ productId: 1, product: { isActive: true, stockQuantity: 5, productType: 'physical' }, items: { quantity: 1, off: true } }),
    ).toBe(false);
  });

  it('items without the off flag, or with it false, still show', () => {
    expect(isUpsellAvailable({ items: { quantity: 2 } })).toBe(true);
    expect(isUpsellAvailable({ items: { quantity: 2, off: false } })).toBe(true);
  });

  it('a product-linked upsell needs an active product with stock (digital needs no stock)', () => {
    expect(isUpsellAvailable({ productId: 1, product: { isActive: true, stockQuantity: 0, productType: 'physical' } })).toBe(false);
    expect(isUpsellAvailable({ productId: 1, product: { isActive: false, stockQuantity: 5, productType: 'physical' } })).toBe(false);
    expect(isUpsellAvailable({ productId: 1, product: { isActive: true, stockQuantity: 0, productType: 'digital' } })).toBe(true);
  });
});
