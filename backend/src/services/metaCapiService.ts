import { createHash } from 'crypto';
import prisma from '../utils/prisma';
import logger from '../utils/logger';
import { decryptString } from '../utils/providerCrypto';

// Meta Conversion API (server-side Purchase events). Restores conversion signal
// that iOS / in-app-browser blockers eat from the client-side Pixel. Events
// carry the same event_id as the client Pixel so Meta deduplicates them.
//
// Best-effort by contract: a CAPI failure NEVER breaks the order flow. The
// caller fires this and ignores the result; everything here is wrapped so it
// can't throw into the order path.

const GRAPH_API_VERSION = 'v18.0';

// Minimal full-name → ISO-3166 alpha-2 map for the markets CodAdmin serves.
// Meta wants a lowercased 2-letter country code; unknown names are omitted
// rather than sent wrong.
const COUNTRY_ISO: Record<string, string> = {
  ghana: 'gh',
  nigeria: 'ng',
  kenya: 'ke',
  'south africa': 'za',
};

const GRAPH_URL = (pixelId: string, accessToken: string): string =>
  `https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

// Trims empty/whitespace strings to undefined so `compact` drops them — used for
// the un-hashed match keys (fbp/fbc/ip/ua) that Meta wants raw, not SHA-256'd.
const raw = (value: string | null | undefined): string | undefined => {
  const v = value?.trim();
  return v ? v : undefined;
};

// SHA-256 of a normalized (trimmed, lowercased) value — Meta's required hashing
// for PII match keys. Returns undefined for empty input so the key is dropped.
function hash(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? sha256(normalized) : undefined;
}

// Phones hash on digits only (no '+', spaces, or dashes) per Meta guidance.
function hashPhone(value: string | null | undefined): string | undefined {
  const digits = value?.replace(/\D/g, '');
  return digits ? sha256(digits) : undefined;
}

// Drops undefined keys so the hashed user_data object only carries real match keys.
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Fire a server-side Purchase event for an order, if its checkout form has Meta
 * CAPI configured. Idempotent via Order.capiEventFired, so it's safe to call
 * from every settlement site (COD create / Paystack verify / webhook). Loads
 * everything it needs from the orderId so each call site is a one-liner.
 */
async function fireCapiPurchaseEvent(orderId: number): Promise<void> {
  try {
    // Single query: the order, its customer, and the form behind it (the
    // order→form link runs through FormSubmission, which is not unique per
    // order, so take the latest submission's form). CAPI + pixel config live on
    // the form.
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        totalAmount: true,
        paymentReference: true,
        capiEventFired: true,
        fbp: true,
        fbc: true,
        customer: {
          select: { email: true, phoneNumber: true, firstName: true, lastName: true, state: true, area: true },
        },
        formSubmissions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            ipAddress: true,
            userAgent: true,
            form: {
              select: {
                productId: true,
                currency: true,
                country: true,
                pixelConfig: true,
                metaCapiAccessToken: true,
                metaCapiTestEventCode: true,
              },
            },
          },
        },
      },
    });
    if (!order) return;

    // Idempotency: only the first settlement site fires; the rest no-op.
    if (order.capiEventFired) return;

    const form = order.formSubmissions[0]?.form;
    if (!form) return;

    const pixelId = (form.pixelConfig as { facebookPixelId?: string } | null)?.facebookPixelId;
    const accessToken = decryptString(form.metaCapiAccessToken);
    // CAPI not configured for this form — nothing to do.
    if (!pixelId || !accessToken) return;

    const customer = order.customer;
    const submission = order.formSubmissions[0];
    const userData = compact({
      em: hash(customer?.email),
      ph: hashPhone(customer?.phoneNumber),
      fn: hash(customer?.firstName),
      ln: hash(customer?.lastName),
      ct: hash(customer?.area || customer?.state),
      country: hash(COUNTRY_ISO[(form.country || '').trim().toLowerCase()]),
      // Un-hashed match keys — Meta requires these RAW, never SHA-256'd. fbp/fbc
      // are the strongest signals when PII (email) is fake/blank, as it often is
      // for COD. IP/UA come from the checkout submission that created the order.
      fbp: raw(order.fbp),
      fbc: raw(order.fbc),
      client_ip_address: raw(submission?.ipAddress),
      client_user_agent: raw(submission?.userAgent),
    });

    const body = {
      data: [
        {
          event_name: 'Purchase',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          // Same id as the client Pixel Purchase → Meta dedupes browser+server.
          event_id: order.paymentReference || String(order.id),
          user_data: userData,
          custom_data: {
            value: order.totalAmount,
            currency: form.currency || 'GHS',
            content_ids: [form.productId],
            content_type: 'product',
          },
        },
      ],
      ...(form.metaCapiTestEventCode ? { test_event_code: form.metaCapiTestEventCode } : {}),
    };

    const res = await fetch(GRAPH_URL(pixelId, accessToken), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('Meta CAPI Purchase event rejected', { orderId, status: res.status, body: text.slice(0, 500) });
      return; // leave capiEventFired false so a later settlement site can retry
    }

    // Mark fired only after a successful POST so a transient failure can retry.
    await prisma.order.update({ where: { id: orderId }, data: { capiEventFired: true } });
    logger.info('Meta CAPI Purchase event sent', { orderId, eventId: body.data[0].event_id });
  } catch (err: any) {
    // Best-effort: never propagate into the order flow.
    logger.error('Meta CAPI fire failed (non-fatal)', { orderId, error: err?.message });
  }
}

/**
 * Fire a server-side InitiateCheckout event when a buyer loads a checkout form.
 *
 * There is no order yet at this point, so this loads pixel/CAPI config straight
 * from the form (by slug) and carries no PII — it relies on fbp/fbc + IP/UA for
 * matching. The client Pixel fires the same event with the same `eventId`, so
 * Meta dedupes browser+server. Best-effort: never throws into the request.
 *
 * Unlike Purchase there's no idempotency flag — InitiateCheckout isn't a
 * conversion and the shared eventId dedupes any repeats within Meta.
 */
async function fireCapiInitiateCheckoutEvent(params: {
  slug: string;
  eventId?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  eventSourceUrl?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
}): Promise<void> {
  try {
    const form = await prisma.checkoutForm.findFirst({
      where: { slug: params.slug, isActive: true },
      select: {
        productId: true,
        currency: true,
        pixelConfig: true,
        metaCapiAccessToken: true,
        metaCapiTestEventCode: true,
      },
    });
    if (!form) return;

    const pixelId = (form.pixelConfig as { facebookPixelId?: string } | null)?.facebookPixelId;
    const accessToken = decryptString(form.metaCapiAccessToken);
    // CAPI not configured for this form — nothing to do.
    if (!pixelId || !accessToken) return;

    const userData = compact({
      fbp: raw(params.fbp),
      fbc: raw(params.fbc),
      client_ip_address: raw(params.clientIpAddress),
      client_user_agent: raw(params.clientUserAgent),
    });
    // Meta rejects events with no match keys at all; skip rather than send a
    // guaranteed-rejected event (should not happen — IP/UA are always present).
    if (Object.keys(userData).length === 0) return;

    const body = {
      data: [
        {
          event_name: 'InitiateCheckout',
          event_time: Math.floor(Date.now() / 1000),
          action_source: 'website',
          // Same id as the client Pixel InitiateCheckout → Meta dedupes browser+server.
          ...(raw(params.eventId) ? { event_id: raw(params.eventId) } : {}),
          ...(raw(params.eventSourceUrl) ? { event_source_url: raw(params.eventSourceUrl) } : {}),
          user_data: userData,
          custom_data: {
            currency: form.currency || 'GHS',
            content_ids: [form.productId],
            content_type: 'product',
          },
        },
      ],
      ...(form.metaCapiTestEventCode ? { test_event_code: form.metaCapiTestEventCode } : {}),
    };

    const res = await fetch(GRAPH_URL(pixelId, accessToken), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.warn('Meta CAPI InitiateCheckout event rejected', {
        slug: params.slug,
        status: res.status,
        body: text.slice(0, 500),
      });
      return;
    }
    logger.info('Meta CAPI InitiateCheckout event sent', { slug: params.slug, eventId: raw(params.eventId) });
  } catch (err: any) {
    // Best-effort: never propagate into the request flow.
    logger.error('Meta CAPI InitiateCheckout fire failed (non-fatal)', { slug: params.slug, error: err?.message });
  }
}

export const metaCapiService = { fireCapiPurchaseEvent, fireCapiInitiateCheckoutEvent };
export default metaCapiService;
