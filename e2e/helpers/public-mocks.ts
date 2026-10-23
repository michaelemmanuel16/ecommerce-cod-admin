import type { Page } from '@playwright/test';

/**
 * COD-37 (M3b-T19, T21): mocks for the public checkout pages. Every `/api/` call is answered here and recorded; anything not
 * listed is recorded in `unmocked`, answered 404, and the test asserts the list is empty. Tracking hosts are never reached:
 * they are aborted, or (when the test is about pixel calls) answered with an empty 200 on this machine. Nothing leaves the
 * browser, so no order is placed, no Meta / Paystack / Resend call is made, and the dev form data is never touched.
 */
export const TRACKING_HOSTS = /connect\.facebook\.net|facebook\.com\/tr|googletagmanager\.com|google-analytics\.com|analytics\.tiktok\.com/i;
const FACEBOOK = /connect\.facebook\.net|facebook\.com\/tr/i;

export const FIELDS = [
  { id: 'fullName', label: 'Full Name', type: 'text', required: true, enabled: true, standardKey: 'fullName' },
  { id: 'phone', label: 'Phone', type: 'phone', required: true, enabled: true, standardKey: 'phone' },
  { id: 'region', label: 'State', type: 'state', required: true, enabled: true, standardKey: 'region' },
  { id: 'town', label: 'City or town', type: 'text', required: true, enabled: true, standardKey: 'town' },
  { id: 'landmark', label: 'Nearest landmark', type: 'text', required: true, enabled: true, standardKey: 'landmark' },
  { id: 'streetAddress', label: 'Street address', type: 'textarea', required: true, enabled: true, standardKey: 'streetAddress' },
];

export const PIXEL_ID = '482915073361842';

export const COD_FORM = {
  id: 1, slug: 'cod-cooldown', name: 'Magic Groove', description: 'Reusable handwriting copybooks', currency: 'GHS', country: 'Ghana',
  formType: 'physical', product: { name: 'Magic Groove Copybooks', price: 249, productType: 'physical', inStock: true },
  fields: FIELDS, regions: { available: ['Greater Accra', 'Ashanti'] }, towns: { 'Greater Accra': ['Osu', 'Madina'] }, design: {},
  codEnabled: true, supportWhatsapp: '+233 24 555 0103', pixelConfig: { facebookPixelId: PIXEL_ID },
  packages: [{ id: 1, name: 'Starter', price: 249, quantity: 1, isPopular: false, isDefault: true, originalPrice: 249, discountType: 'none' }],
  upsells: [],
};

export const DIGITAL_FORM = {
  ...COD_FORM, id: 2, slug: 'guide', name: 'The Guide', formType: 'digital', pixelConfig: null,
  product: { name: 'The Guide', price: 100, productType: 'digital', inStock: true },
  codEnabled: false, paystackFullEnabled: true,
  packages: [{ id: 9, name: 'The Guide', price: 100, quantity: 1, isPopular: false, isDefault: true, originalPrice: 100, discountType: 'none' }],
};

export interface Hits {
  /** Bodies of the mocked order POSTs. */
  orders: Array<Record<string, any>>;
  /** Bodies of the mocked initiate-checkout (CAPI mirror) POSTs. */
  initiateCheckout: Array<Record<string, any>>;
  /** Number of mocked verify calls. */
  verifyCalls: number;
  /** Any /api/ call that was not mocked. */
  unmocked: string[];
  /** Every tracking-host request the page tried, as `METHOD url`. */
  tracking: string[];
  /** Facebook pixel image beacons (facebook.com/tr) as parsed URLs. */
  beacons: URL[];
}

export interface MockOptions {
  form: unknown;
  order?: { status: number; body: unknown };
  /** Answers for GET /api/payments/verify/*: each call takes the next one, the last repeats. */
  verify?: unknown[];
  /** Answer facebook hosts with an empty 200 (to see the pixel calls). Otherwise they are aborted. Other hosts are always aborted. */
  allowFacebook?: boolean;
}

export async function mockPublicApi(page: Page, opts: MockOptions): Promise<Hits> {
  const hits: Hits = { orders: [], initiateCheckout: [], verifyCalls: 0, unmocked: [], tracking: [], beacons: [] };

  await page.route(TRACKING_HOSTS, (route) => {
    const req = route.request();
    hits.tracking.push(`${req.method()} ${req.url()}`);
    if (/facebook\.com\/tr/i.test(req.url())) hits.beacons.push(new URL(req.url()));
    if (opts.allowFacebook && FACEBOOK.test(req.url())) {
      return route.fulfill({ status: 200, contentType: /\.js/.test(req.url()) ? 'application/javascript' : 'image/gif', body: '' });
    }
    return route.abort();
  });

  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (/\/api\/admin\/config/.test(url)) return json(200, { businessName: 'Test Store', currency: 'GHS' });
    if (/\/api\/public\/forms\/[^/]+\/orders$/.test(url) && method === 'POST') {
      hits.orders.push(route.request().postDataJSON());
      const o = opts.order ?? { status: 201, body: { success: true, orderId: 24118, orderNumber: '#24118', message: 'ok' } };
      return json(o.status, o.body);
    }
    if (/\/track\/initiate-checkout$/.test(url) && method === 'POST') {
      hits.initiateCheckout.push(route.request().postDataJSON());
      return json(202, { success: true });
    }
    if (/\/api\/public\/forms\/[^/]+$/.test(url) && method === 'GET') return json(200, { form: opts.form });
    if (/\/api\/payments\/verify\//.test(url) && method === 'GET') {
      const queue = [...(opts.verify ?? [])];
      const answer = queue[Math.min(hits.verifyCalls, queue.length - 1)];
      hits.verifyCalls += 1;
      return json(200, answer);
    }
    hits.unmocked.push(`${method} ${url}`);
    return json(404, {});
  });

  return hits;
}
