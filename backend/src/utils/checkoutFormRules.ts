// Checkout form basics and tracking rules (COD-33, F-411, F-416), shared by create, update and clone.

/** Error text for a thank-you page URL, or null. Empty is allowed. */
export function redirectUrlError(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!text) return null;
  try {
    if (new URL(text).protocol === 'https:') return null;
  } catch {
    // fall through
  }
  return 'Thank-you page must start with https://';
}

const HOST = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(:\d{1,5})?$/i;

/**
 * Allowed domains as stored: `https://host[:port]`, the form the embed gate compares with the browser's `Origin` header.
 * A bare host gets `https://`. http, paths, wildcards and anything that is not a host are refused; the first bad entry is named.
 */
export function normalizeAllowedOrigins(raw: unknown): { origins: string[] } | { bad: string } {
  if (!Array.isArray(raw)) return { origins: [] };
  const origins = new Set<string>();
  for (const entry of raw) {
    const text = String(entry).trim();
    if (!text) continue;
    const host = /^https:\/\//i.test(text) ? text.slice(8).replace(/\/$/, '') : text;
    if (!HOST.test(host)) return { bad: text };
    origins.add(`https://${host.toLowerCase()}`);
  }
  return { origins: [...origins] };
}

/** Error text for the ids in pixelConfig, or null. Empty ids are allowed. */
export function pixelConfigError(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as Record<string, unknown>;
  const bad = (key: string, ok: RegExp) => typeof c[key] === 'string' && c[key] !== '' && !ok.test(c[key] as string);
  if (bad('facebookPixelId', /^\d+$/)) return 'Facebook Pixel ID must be digits only.';
  if (bad('googleAnalyticsId', /^G-[A-Z0-9]+$/)) return 'Google Analytics ID must start with G-.';
  if (bad('googleTagManagerId', /^GTM-[A-Z0-9]+$/)) return 'Google Tag Manager ID must start with GTM-.';
  return null;
}

type UpsellStock = { productId?: number | null; product?: { isActive: boolean; productType: string } | null };

/** Available to sell per physical product id (stockService.getAvailableMany): on hand less reserved. A digital product is absent. */
export type AvailableMap = ReadonlyMap<number, number>;

/** An upsell shows only while it is switched on. A product-linked upsell also needs its product active and, for a physical product, available to sell. */
export function isUpsellAvailable(upsell: UpsellStock & { isActive?: boolean }, available: AvailableMap): boolean {
  // The editor's on/off switch.
  if (upsell.isActive === false) return false;
  const product = upsell.product;
  if (!upsell.productId || !product) return true;
  return product.isActive && (product.productType === 'digital' || (available.get(upsell.productId) ?? 0) > 0);
}

/** The form product's in-stock flag: a physical product needs units available to sell; a digital one keeps its old rule (cached number above 0). */
export function productInStock(productId: number, product: { productType: string; stockQuantity: number }, available: AvailableMap): boolean {
  return product.productType === 'digital' ? product.stockQuantity > 0 : (available.get(productId) ?? 0) > 0;
}
