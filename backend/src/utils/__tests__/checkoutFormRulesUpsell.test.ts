import { describe, it, expect } from '@jest/globals';
import { isUpsellAvailable } from '../checkoutFormRules';

describe('isUpsellAvailable (F-415)', () => {
  it('a manual upsell shows', () => {
    expect(isUpsellAvailable({ productId: null, product: null })).toBe(true);
  });

  it('an upsell switched off in the editor (isActive false) is hidden, linked to a product or not', () => {
    expect(isUpsellAvailable({ productId: null, isActive: false })).toBe(false);
    expect(isUpsellAvailable({ productId: 1, product: { isActive: true, available: 5, productType: 'physical' }, isActive: false })).toBe(false);
  });

  it('isActive true or missing still shows', () => {
    expect(isUpsellAvailable({ isActive: true })).toBe(true);
    expect(isUpsellAvailable({})).toBe(true);
  });

  it('a product-linked upsell needs an active product with stock (digital needs no stock)', () => {
    expect(isUpsellAvailable({ productId: 1, product: { isActive: true, available: 0, productType: 'physical' } })).toBe(false);
    expect(isUpsellAvailable({ productId: 1, product: { isActive: false, available: 5, productType: 'physical' } })).toBe(false);
    expect(isUpsellAvailable({ productId: 1, product: { isActive: true, available: 0, productType: 'digital' } })).toBe(true);
  });
});
