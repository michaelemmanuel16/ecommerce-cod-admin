import { describe, it, expect } from '@jest/globals';
import { isUpsellAvailable, productInStock } from '../checkoutFormRules';

const none = new Map<number, number>();
const stock = (n: number) => new Map([[1, n]]);

describe('isUpsellAvailable (F-415)', () => {
  it('a manual upsell shows', () => {
    expect(isUpsellAvailable({ productId: null, product: null }, none)).toBe(true);
  });

  it('an upsell switched off in the editor (isActive false) is hidden, linked to a product or not', () => {
    expect(isUpsellAvailable({ productId: null, isActive: false }, none)).toBe(false);
    expect(isUpsellAvailable({ productId: 1, product: { isActive: true, productType: 'physical' }, isActive: false }, stock(5))).toBe(false);
  });

  it('isActive true or missing still shows', () => {
    expect(isUpsellAvailable({ isActive: true }, none)).toBe(true);
    expect(isUpsellAvailable({}, none)).toBe(true);
  });

  it('a product-linked upsell needs an active product available to sell (digital needs no stock)', () => {
    expect(isUpsellAvailable({ productId: 1, product: { isActive: true, productType: 'physical' } }, stock(0))).toBe(false);
    expect(isUpsellAvailable({ productId: 1, product: { isActive: true, productType: 'physical' } }, none)).toBe(false);
    expect(isUpsellAvailable({ productId: 1, product: { isActive: false, productType: 'physical' } }, stock(5))).toBe(false);
    expect(isUpsellAvailable({ productId: 1, product: { isActive: true, productType: 'physical' } }, stock(5))).toBe(true);
    expect(isUpsellAvailable({ productId: 1, product: { isActive: true, productType: 'digital' } }, none)).toBe(true);
  });
});

describe('productInStock', () => {
  it('a physical product is in stock when units are available to sell, whatever the cached number says', () => {
    expect(productInStock(1, { productType: 'physical', stockQuantity: 40 }, stock(0))).toBe(false);
    expect(productInStock(1, { productType: 'physical', stockQuantity: 0 }, stock(3))).toBe(true);
  });
  it('a digital product keeps its old rule: the cached number above 0', () => {
    expect(productInStock(1, { productType: 'digital', stockQuantity: 0 }, none)).toBe(false);
    expect(productInStock(1, { productType: 'digital', stockQuantity: 1 }, none)).toBe(true);
  });
});
