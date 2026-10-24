/**
 * COD-37 (M3b-T19, F-407): a COD order placed through the public route reaches the real metaCapiService, and the Meta
 * request (global fetch is replaced; Meta is never called) carries event_id = the raw order id from the answer, while the
 * answer's orderNumber is "#<id>". Browser side of the same id: frontend OrderSuccessTracking.test.tsx and e2e/19.
 * Also: an order that is repeated inside the duplicate window sends no second Meta request.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { clearCheckoutFormConfigCache } from '../../services/checkoutFormService';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { stockUp } from './helpers/stock';

jest.setTimeout(120_000);

let pair: TwoTenants;
let slug: string;
const realFetch = global.fetch;
let metaCalls: Array<{ url: string; raw: string }> = [];

let seq = 0;
const phone = () => `+23324${String(Date.now() % 1_000_000).padStart(6, '0')}${seq++ % 10}`;
const place = (body: Record<string, unknown>, ip: string) =>
  request(app).post(`/api/public/forms/${slug}/orders`).set('X-Forwarded-For', ip)
    .send({ totalAmount: 1, selectedPackage: { name: 'One', price: 1, quantity: 1 }, ...body });

/** A fake fetch for the whole process: Meta is answered locally; any other host (email, SMS) gets a refusal and is never reached. */
const mockMeta = () => {
  metaCalls = [];
  (global as any).fetch = async (url: string, opts: { body: string }) => {
    if (/graph\.facebook\.com/.test(url)) {
      metaCalls.push({ url, raw: opts.body });
      return { ok: true, status: 200, text: async () => '' };
    }
    return { ok: false, status: 503, text: async () => '', json: async () => ({}) };
  };
};
const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 50));
};

beforeAll(async () => {
  pair = await createTwoTenants('t19');
  const tenantId = pair.a.id;
  const product = await prismaBase.product.create({
    data: { name: 'T19 product', sku: `T19-${Date.now()}`, category: 'test', price: 10, stockQuantity: 10, tenantId } as never,
  });
  await stockUp(tenantId, product.id, 10); // available to sell comes from the levels (M4-T16)
  slug = `t19-${pair.a.slug}`;
  const form = await prismaBase.checkoutForm.create({
    data: {
      name: slug, slug, productId: product.id, fields: [], styling: {}, regions: { available: ['Greater Accra'] }, tenantId,
      currency: 'GHS', country: 'Ghana', pixelConfig: { facebookPixelId: '482915073361842' },
      metaCapiAccessToken: 'capi-t19-token', metaCapiTestEventCode: 'TEST19',
    } as never,
  });
  await prismaBase.formPackage.create({ data: { formId: form.id, name: 'One', price: 10, quantity: 1 } });
});

afterEach(() => {
  global.fetch = realFetch;
  clearCheckoutFormConfigCache();
});

afterAll(async () => {
  global.fetch = realFetch;
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('COD order to Meta Purchase', () => {
  it('sends one Purchase whose event_id is the order id in the answer, hashed, with the form pixel and test code', async () => {
    mockMeta();
    const p = phone();
    const res = await place({ formData: { name: 'Ama Mensah', phoneNumber: p, email: 'ama.mensah@example.com', state: 'Greater Accra', town: 'Osu', landmark: 'Near the Total station' } }, '10.19.0.1');
    expect(res.status).toBe(201);
    expect(res.body.orderNumber).toBe(`#${res.body.orderId}`);

    await waitFor(() => metaCalls.length > 0);
    expect(metaCalls).toHaveLength(1);
    const body = JSON.parse(metaCalls[0].raw);
    expect(metaCalls[0].url).toContain('/482915073361842/events');
    expect(body.test_event_code).toBe('TEST19');
    expect(body.data[0]).toMatchObject({ event_name: 'Purchase', action_source: 'website', event_id: String(res.body.orderId) });
    expect(body.data[0].custom_data).toMatchObject({ currency: 'GHS' });
    expect(metaCalls[0].raw).not.toContain(`#${res.body.orderId}`);
    expect(metaCalls[0].raw).not.toContain(p.replace('+', ''));
    expect(metaCalls[0].raw).not.toContain('ama.mensah@example.com');
  });

  it('the same buyer repeating inside the duplicate window sends no second Meta request', async () => {
    mockMeta();
    const p = phone();
    const buyer = { name: 'Kofi Boateng', phoneNumber: p, state: 'Greater Accra', town: 'Osu', landmark: 'Near the Total station' };
    const first = await place({ formData: buyer }, '10.19.0.2');
    expect(first.status).toBe(201);
    await waitFor(() => metaCalls.length > 0);
    expect(metaCalls).toHaveLength(1);

    const again = await place({ formData: buyer }, '10.19.0.2');
    expect(again.body).toMatchObject({ deduplicated: true, orderId: first.body.orderId });
    await new Promise((r) => setTimeout(r, 300));
    expect(metaCalls).toHaveLength(1);
  });
});
