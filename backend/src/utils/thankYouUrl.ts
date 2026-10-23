/**
 * The merchant's thank-you page URL with the order details appended (F-403).
 * Mirrors `buildRedirectUrl` in frontend/src/lib/orderPayload.ts: same param names, same order (order_id, total, currency,
 * reference, package). The checkout page builds it for COD; the payment verify answer builds it for online payments.
 * Null for no URL or one that does not parse.
 */
export function buildThankYouUrl(
  redirectUrl: string | null | undefined,
  params: { orderId: number; total?: number; currency?: string | null; reference?: string | null; package?: number | string | null },
): string | null {
  if (!redirectUrl) return null;
  try {
    const url = new URL(redirectUrl);
    url.searchParams.set('order_id', String(params.orderId));
    if (params.total != null) url.searchParams.set('total', String(params.total));
    if (params.currency) url.searchParams.set('currency', params.currency);
    if (params.reference) url.searchParams.set('reference', String(params.reference));
    if (params.package != null) url.searchParams.set('package', String(params.package));
    return url.toString();
  } catch {
    return null;
  }
}
