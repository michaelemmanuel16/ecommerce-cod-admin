// Package prices (F-414): final price = sets x product price - discount. One function for the Packages table, the live
// preview and the save payload, so the three always agree.
import type { ProductPackage } from '../types/checkout-form';

type Priced = Pick<ProductPackage, 'quantity' | 'discountType' | 'discountValue'>;

const money = (n: number): number => Math.round(n * 100) / 100;

/** Sets x product price, before any discount. */
export function packageOriginalPrice(productPrice: number, pkg: Pick<ProductPackage, 'quantity'>): number {
  return money(productPrice * (Number(pkg.quantity) || 0));
}

/** The discount as money in the store currency. A percent discount shows as its computed amount. */
export function packageDiscountAmount(productPrice: number, pkg: Priced): number {
  const original = packageOriginalPrice(productPrice, pkg);
  const value = Math.max(0, Number(pkg.discountValue) || 0);
  if (pkg.discountType === 'percentage') return money((original * value) / 100);
  if (pkg.discountType === 'fixed') return money(value);
  return 0;
}

/**
 * What the buyer pays for the package. Not clamped at zero: a discount larger than the price shows as a negative
 * number so the editor can say so and block the save (see `packageIssue`).
 */
export function packageFinalPrice(productPrice: number, pkg: Priced): number {
  return money(packageOriginalPrice(productPrice, pkg) - packageDiscountAmount(productPrice, pkg));
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
