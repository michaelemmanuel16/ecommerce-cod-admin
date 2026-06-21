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

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

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
        customer: {
          select: { email: true, phoneNumber: true, firstName: true, lastName: true, state: true, area: true },
        },
        formSubmissions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
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
    const userData = compact({
      em: hash(customer?.email),
      ph: hashPhone(customer?.phoneNumber),
      fn: hash(customer?.firstName),
      ln: hash(customer?.lastName),
      ct: hash(customer?.area || customer?.state),
      country: hash(COUNTRY_ISO[(form.country || '').trim().toLowerCase()]),
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

    const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`;
    const res = await fetch(url, {
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

export const metaCapiService = { fireCapiPurchaseEvent };
export default metaCapiService;
