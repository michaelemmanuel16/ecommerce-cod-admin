// Network layer for the embed widget. Uses native fetch (no axios) to keep the
// bundle small. The order-payload mapping is shared with the hosted checkout
// page via src/lib/orderPayload so the two paths post identical shapes.
import type { PublicCheckoutForm } from '../src/services/public-orders.service';
import { buildOrderPayload } from '../src/lib/orderPayload';

export { buildOrderPayload };

// The config endpoint returns the public form payload plus the Paystack public key.
export type EmbedFormConfig = PublicCheckoutForm & { paystackPublicKey?: string };

export async function fetchFormConfig(apiBase: string, slug: string): Promise<EmbedFormConfig> {
  const res = await fetch(`${apiBase}/api/public/forms/${encodeURIComponent(slug)}/config`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Failed to load checkout (${res.status})`);
  }
  const json = await res.json();
  return json.config as EmbedFormConfig;
}

export interface OrderResponse {
  success: boolean;
  // Present for COD only. Paystack defers order creation until payment is
  // confirmed and returns authorization_url instead.
  orderId?: number;
  message?: string;
  authorization_url?: string;
  paymentReference?: string;
  order?: { id: number; totalAmount: number; status: string };
}

// Best-effort server-side InitiateCheckout signal, mirrored from the hosted
// checkout page. Fired once when the widget loads so the event still reaches
// Meta via CAPI when the in-app browser blocks the client pixel. The eventId is
// shared with the browser beacon so Meta dedupes them. Never throws — tracking
// must not disrupt checkout.
export async function trackInitiateCheckout(
  apiBase: string,
  slug: string,
  data: { eventId?: string; eventSourceUrl?: string; fbp?: string; fbc?: string },
): Promise<void> {
  try {
    await fetch(`${apiBase}/api/public/forms/${encodeURIComponent(slug)}/track/initiate-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      keepalive: true,
    });
  } catch {
    /* best-effort — swallow */
  }
}

export async function submitOrder(
  apiBase: string,
  slug: string,
  // fbp/fbc are optional best-effort Meta click ids merged in by the caller.
  payload: ReturnType<typeof buildOrderPayload>['payload'] & { fbp?: string; fbc?: string },
): Promise<OrderResponse> {
  const res = await fetch(`${apiBase}/api/public/forms/${encodeURIComponent(slug)}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as OrderResponse & { error?: string };
  if (!res.ok || json.success === false) {
    throw new Error(json.error || json.message || 'Failed to place order');
  }
  return json;
}
