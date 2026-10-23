import { describe, it, expect } from 'vitest';
import { packageDiscountAmount, packageFinalPrice, packageIssue, packageOriginalPrice, withComputedPrices } from '../../lib/packagePricing';
import type { ProductPackage } from '../../types/checkout-form';

const pkg = (over: Partial<ProductPackage>): ProductPackage =>
  ({ id: 1, name: 'p', price: 0, quantity: 1, isPopular: false, discountType: 'none', discountValue: 0, ...over }) as ProductPackage;

describe('packageFinalPrice (F-414)', () => {
  it('2 sets of GH₵249 with a fixed 49 off is 449', () => {
    expect(packageFinalPrice(249, pkg({ quantity: 2, discountType: 'fixed', discountValue: 49 }))).toBe(449);
  });

  it('3 sets of GH₵249 with a fixed 118 off is 629', () => {
    expect(packageFinalPrice(249, pkg({ quantity: 3, discountType: 'fixed', discountValue: 118 }))).toBe(629);
  });

  it('a percent discount takes that share of sets x price, and shows as money', () => {
    const p = pkg({ quantity: 2, discountType: 'percentage', discountValue: 10 });
    expect(packageOriginalPrice(249, p)).toBe(498);
    expect(packageDiscountAmount(249, p)).toBe(49.8);
    expect(packageFinalPrice(249, p)).toBe(448.2);
  });

  it('no discount is sets x price', () => {
    expect(packageFinalPrice(249, pkg({ quantity: 3 }))).toBe(747);
  });

  it('a negative discount value never raises the price', () => {
    expect(packageFinalPrice(249, pkg({ discountType: 'fixed', discountValue: -50 }))).toBe(249);
  });
});

describe('packageIssue', () => {
  it('blocks fewer than 1 set', () => {
    expect(packageIssue(249, pkg({ quantity: 0 }))).toBe('Sets must be at least 1.');
  });

  it('blocks a final price below zero', () => {
    expect(packageIssue(249, pkg({ discountType: 'fixed', discountValue: 300 }))).toBe('Final price cannot be below zero.');
    expect(packageIssue(249, pkg({ discountType: 'percentage', discountValue: 120 }))).toBe('Final price cannot be below zero.');
  });

  it('lets a free package through', () => {
    expect(packageIssue(249, pkg({ discountType: 'fixed', discountValue: 249 }))).toBeNull();
  });
});

describe('withComputedPrices', () => {
  it('sets price and originalPrice from the product price', () => {
    const [a] = withComputedPrices([pkg({ quantity: 2, discountType: 'fixed', discountValue: 49, price: 1, originalPrice: 1 })], 249);
    expect(a.price).toBe(449);
    expect(a.originalPrice).toBe(498);
  });

  it('leaves the packages alone when no product price is known', () => {
    const list = [pkg({ price: 12 })];
    expect(withComputedPrices(list, 0)).toBe(list);
  });
});
