// Package prices (F-414): final price = sets x product price - discount. One function for the Packages table, the live
// preview and the save payload, so the three always agree.
import type { ProductPackage } from '../types/checkout-form';
import { formatMoney } from '../utils/money';

type Priced = Pick<ProductPackage, 'quantity' | 'discountType' | 'discountValue'>;

const money = (n: number): number => Math.round(n * 100) / 100;

/** A price after a percent or fixed discount, rounded to cents. A negative discount value never raises the price. Not clamped at zero. */
export function applyDiscount(price: number, type: ProductPackage['discountType'], value: number | undefined): number {
  const v = Math.max(0, Number(value) || 0);
  if (type === 'percentage') return money(price - (price * v) / 100);
  if (type === 'fixed') return money(price - v);
  return money(price);
}

/** Sets x product price, before any discount. */
export function packageOriginalPrice(productPrice: number, pkg: Pick<ProductPackage, 'quantity'>): number {
  return money(productPrice * (Number(pkg.quantity) || 0));
}

/** The discount as money in the store currency. A percent discount shows as its computed amount. */
export function packageDiscountAmount(productPrice: number, pkg: Priced): number {
  const original = packageOriginalPrice(productPrice, pkg);
  return money(original - applyDiscount(original, pkg.discountType, pkg.discountValue));
}

/**
 * What the buyer pays for the package. Not clamped at zero: a discount larger than the price shows as a negative
 * number so the editor can say so and block the save (see `packageIssue`).
 */
export function packageFinalPrice(productPrice: number, pkg: Priced): number {
  return applyDiscount(packageOriginalPrice(productPrice, pkg), pkg.discountType, pkg.discountValue);
}

/** The reason a package cannot be saved, or null. */
export function packageIssue(productPrice: number, pkg: Priced): string | null {
  if (!(Number(pkg.quantity) >= 1)) return 'Sets must be at least 1.';
  if (packageFinalPrice(productPrice, pkg) < 0) return 'Final price cannot be below zero.';
  return null;
}

/** The packages with `originalPrice` and `price` taken from the product price. Left alone when no product price is known. */
export function withComputedPrices(packages: ProductPackage[], productPrice: number): ProductPackage[] {
  if (!(productPrice > 0)) return packages;
  return packages.map((pkg) => ({
    ...pkg,
    originalPrice: packageOriginalPrice(productPrice, pkg),
    price: packageFinalPrice(productPrice, pkg),
  }));
}

/** The public package shape the buyer sees: prices are already computed. */
type PublicPriced = {
  price: number;
  originalPrice?: number;
  discountType?: ProductPackage['discountType'];
  discountValue?: number;
  showDiscount?: boolean;
};

/** The one rule for "this package is discounted" on the public page, and the text of its saving pill. */
export function packageSaving(pkg: PublicPriced, currency: string): { hasDiscount: boolean; saveLabel: string | null } {
  const hasDiscount = !!pkg.originalPrice && pkg.originalPrice > pkg.price && pkg.showDiscount !== false;
  if (!hasDiscount || !pkg.discountValue) return { hasDiscount, saveLabel: null };
  if (pkg.discountType === 'percentage') return { hasDiscount, saveLabel: `Save ${pkg.discountValue}%` };
  if (pkg.discountType === 'fixed') return { hasDiscount, saveLabel: `Save ${formatMoney(money(pkg.originalPrice! - pkg.price), currency)}` };
  return { hasDiscount, saveLabel: null };
}
