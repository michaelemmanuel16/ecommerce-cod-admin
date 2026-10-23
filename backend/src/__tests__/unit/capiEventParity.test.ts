/**
 * COD-37 (M3b-T19, F-407): the server half of the Meta event contract, with the Meta HTTP call mocked.
 * Extends metaCapiService.test.ts (which stays as it is) with the lines it does not hold:
 *  - action_source, the test event code, value and currency in the store currency;
 *  - no raw phone, email or name anywhere in the payload (SHA-256 of normalised values only);
 *  - event id parity with the browser: COD uses the raw order id, online uses the payment reference, and the
 *    "#<id>" display number never reaches Meta (the browser half is in frontend/src/__tests__/components/OrderSuccessTracking.test.tsx).
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createHash } from 'crypto';

jest.mock('../../utils/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

import { prismaMock } from '../mocks/prisma.mock';
import { metaCapiService } from '../../services/metaCapiService';
import { formatOrderNumber } from '../../utils/orderNumber';

const sha = (v: string) => createHash('sha256').update(v).digest('hex');

// A Nigerian store: the event must carry NGN, never the GHS default.
const ngnForm = {
  productId: 3,
  currency: 'NGN',
  country: 'Nigeria',
  pixelConfig: { facebookPixelId: '482915073361842' },
  metaCapiAccessToken: 'token-abc',
  metaCapiTestEventCode: 'TEST42',
};

const order = (form: unknown, overrides: Record<string, unknown> = {}) => ({
  id: 24118,
  totalAmount: 15500,
  paymentReference: null,
  capiEventFired: false,
  fbp: null,
  fbc: null,
  customer: { email: 'Ngozi.Eze@Example.com', phoneNumber: '+234 803 123 4567', firstName: 'Ngozi', lastName: 'Eze', state: 'Lagos', area: 'Ikeja' },
  formSubmissions: form ? [{ form, ipAddress: '10.0.0.1', userAgent: 'UA/1' }] : [],
  ...overrides,
});

let fetchMock: jest.Mock;
const sent = () => {
  const [url, opts] = fetchMock.mock.calls[0] as [string, { body: string }];
  const body = JSON.parse(opts.body);
  return { url, raw: opts.body, body, event: body.data[0] };
};

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock = jest.fn(async () => ({ ok: true, text: async () => '' })) as any;
  (global as any).fetch = fetchMock;
  (prismaMock.order.findUnique as any).mockResolvedValue(order(ngnForm));
  (prismaMock.order.update as any).mockResolvedValue({});
  (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(ngnForm);
});

describe('Purchase payload (COD order creation)', () => {
  it('names the event, the website source, the store currency, the value and the test event code', async () => {
    await metaCapiService.fireCapiPurchaseEvent(24118);

    const { url, body, event } = sent();
    expect(url).toContain('graph.facebook.com');
    expect(url).toContain('/482915073361842/events');
    expect(event.event_name).toBe('Purchase');
    expect(event.action_source).toBe('website');
    expect(typeof event.event_time).toBe('number');
    expect(event.custom_data).toMatchObject({ value: 15500, currency: 'NGN', content_ids: [3], content_type: 'product' });
    expect(typeof event.custom_data.value).toBe('number');
    expect(body.test_event_code).toBe('TEST42');
    expect(event.user_data.country).toBe(sha('ng'));
  });

  it('sends no test_event_code when the form has none', async () => {
    (prismaMock.order.findUnique as any).mockResolvedValue(order({ ...ngnForm, metaCapiTestEventCode: null }));
    await metaCapiService.fireCapiPurchaseEvent(24118);
    expect(sent().body).not.toHaveProperty('test_event_code');
  });

  it('carries only hashes for phone, email and names: no raw value anywhere in the request', async () => {
    await metaCapiService.fireCapiPurchaseEvent(24118);

    const { raw, event } = sent();
    for (const secret of ['+234 803 123 4567', '2348031234567', '08031234567', 'Ngozi.Eze@Example.com', 'ngozi.eze@example.com', 'Ngozi', 'Eze', 'Ikeja']) {
      expect(raw).not.toContain(secret);
    }
    expect(event.user_data.em).toBe(sha('ngozi.eze@example.com'));
    expect(event.user_data.ph).toBe(sha('2348031234567'));
    expect(event.user_data.fn).toBe(sha('ngozi'));
    expect(event.user_data.ln).toBe(sha('eze'));
    expect(event.user_data.ct).toBe(sha('ikeja'));
    for (const key of ['em', 'ph', 'fn', 'ln', 'ct', 'country']) {
      expect(event.user_data[key]).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('makes no call when the form has no CAPI token, no pixel id, or the order has no form', async () => {
    for (const form of [{ ...ngnForm, metaCapiAccessToken: null }, { ...ngnForm, pixelConfig: {} }, { ...ngnForm, pixelConfig: null }, null]) {
      (prismaMock.order.findUnique as any).mockResolvedValue(order(form));
      await metaCapiService.fireCapiPurchaseEvent(24118);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prismaMock.order.update).not.toHaveBeenCalled();
  });
});

describe('event id parity with the browser', () => {
  it('COD: event_id is the raw order id, the same string the browser Purchase uses as eventID', async () => {
    await metaCapiService.fireCapiPurchaseEvent(24118);
    const { raw, event } = sent();
    expect(event.event_id).toBe('24118'); // browser: String(orderId)
    expect(event.event_id).not.toBe(formatOrderNumber(24118));
    expect(raw).not.toContain('#');
  });

  it('online settlement: event_id is the payment reference (the browser fires no Purchase for these)', async () => {
    (prismaMock.order.findUnique as any).mockResolvedValue(order(ngnForm, { paymentReference: 'ref_8d1c' }));
    await metaCapiService.fireCapiPurchaseEvent(24118);
    const { raw, event } = sent();
    expect(event.event_id).toBe('ref_8d1c');
    expect(raw).not.toContain('#24118');
  });

  it('the display format is a hash sign plus the id, so changing it cannot change the event id', () => {
    expect(formatOrderNumber(24118)).toBe('#24118');
    expect(String(24118)).toBe('24118');
  });
});

describe('InitiateCheckout mirror payload', () => {
  const fire = (extra: Record<string, unknown> = {}) =>
    metaCapiService.fireCapiInitiateCheckoutEvent({
      slug: 'guide', eventId: 'evt-9', fbp: 'fb.1.1.p', eventSourceUrl: 'https://shop.example/form/guide',
      clientIpAddress: '10.0.0.9', clientUserAgent: 'UA/1', ...extra,
    });

  it('names the event, website source, store currency and test code; carries the browser event id', async () => {
    await fire();
    const { body, event } = sent();
    expect(event.event_name).toBe('InitiateCheckout');
    expect(event.action_source).toBe('website');
    expect(event.event_id).toBe('evt-9');
    expect(event.custom_data).toMatchObject({ currency: 'NGN', content_ids: [3], content_type: 'product' });
    expect(body.test_event_code).toBe('TEST42');
  });

  it('holds no hashed or raw personal data and no value (nobody has typed anything yet)', async () => {
    await fire();
    const { event } = sent();
    for (const key of ['em', 'ph', 'fn', 'ln', 'ct']) expect(event.user_data).not.toHaveProperty(key);
    expect(event.custom_data).not.toHaveProperty('value');
  });

  it('makes no call when the form has no token or no pixel id', async () => {
    for (const form of [{ ...ngnForm, metaCapiAccessToken: null }, { ...ngnForm, pixelConfig: {} }]) {
      (prismaMock.checkoutForm.findFirst as any).mockResolvedValue(form);
      await fire();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
