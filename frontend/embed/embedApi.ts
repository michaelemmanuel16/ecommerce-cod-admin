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
  orderId: number;
  message?: string;
  authorization_url?: string;
  paymentReference?: string;
  order?: { id: number; totalAmount: number; status: string };
}

export async function submitOrder(
  apiBase: string,
  slug: string,
  payload: ReturnType<typeof buildOrderPayload>['payload'],
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
