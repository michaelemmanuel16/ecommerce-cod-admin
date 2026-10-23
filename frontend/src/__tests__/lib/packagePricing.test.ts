import { describe, it, expect } from 'vitest';
import { applyDiscount, packageDiscountAmount, packageFinalPrice, packageIssue, packageOriginalPrice, packageSaving, withComputedPrices } from '../../lib/packagePricing';
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

describe('applyDiscount', () => {
  it('takes a percent or a fixed amount off, rounds to cents, and ignores a negative value', () => {
    expect(applyDiscount(200, 'percentage', 25)).toBe(150);
    expect(applyDiscount(199.99, 'percentage', 10)).toBe(179.99);
    expect(applyDiscount(200, 'fixed', 30)).toBe(170);
    expect(applyDiscount(200, 'none', 30)).toBe(200);
    expect(applyDiscount(200, 'fixed', -30)).toBe(200);
    expect(applyDiscount(20, 'fixed', 30)).toBe(-10);
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

describe('packageSaving (the one public discount rule)', () => {
  const pub = (over: Record<string, unknown>) => ({ price: 90, originalPrice: 100, discountType: 'percentage' as const, discountValue: 10, ...over });

  it('percentage: Save 10%', () => {
    expect(packageSaving(pub({}), 'GHS')).toEqual({ hasDiscount: true, saveLabel: 'Save 10%' });
  });

  it('fixed with cents rounds to cents', () => {
    const r = packageSaving(pub({ price: 59.7, originalPrice: 99.9, discountType: 'fixed', discountValue: 40.2 }), 'GHS');
    expect(r.hasDiscount).toBe(true);
    expect(r.saveLabel).toBe('Save GH₵40.20');
  });

  it('showDiscount false hides it', () => {
    expect(packageSaving(pub({ showDiscount: false }), 'GHS')).toEqual({ hasDiscount: false, saveLabel: null });
  });

  it('a zero value is a discount with no pill', () => {
    expect(packageSaving(pub({ discountValue: 0 }), 'GHS')).toEqual({ hasDiscount: true, saveLabel: null });
  });

  it('no originalPrice is no discount', () => {
    expect(packageSaving(pub({ originalPrice: undefined }), 'GHS')).toEqual({ hasDiscount: false, saveLabel: null });
  });
});
