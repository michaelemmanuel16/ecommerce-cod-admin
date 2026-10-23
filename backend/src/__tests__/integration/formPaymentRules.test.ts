/**
 * M3b-T05 (COD-31, F-400, F-402): the method matrix on the checkout-forms API and on the public order route.
 * Physical forms take COD only while features.prepaidPhysical is off; digital forms take online payment in full;
 * a tampered request with a disabled method gets 400; the old method names still work; new rows store the neutral names.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { clearPaymentConfigCache } from '../../services/payments';
import { clearCheckoutFormConfigCache } from '../../services/checkoutFormService';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { bearer, superAdminToken } from './helpers/superAdminToken';

jest.setTimeout(120_000);

process.env.PROVIDER_ENCRYPTION_KEY = 'cd'.repeat(32);
const originalFetch = global.fetch;
let pair: TwoTenants;
let ownerToken: string;
let digitalFormSlug: string;
let digitalFormId: number;
let phoneSeq = 0;

const setFlag = (on: boolean | null) =>
  prismaBase.systemConfig.updateMany({ where: { tenantId: pair.a.id }, data: { features: on === null ? {} : { prepaidPhysical: on } } });
const buyerPhone = () => `+23324${String(Date.now()).slice(-6)}${phoneSeq++ % 10}`;
let ipSeq = 1;
const order = (slug: string, extra: Record<string, unknown> = {}) =>
  request(app)
    .post(`/api/public/forms/${slug}/orders`)
    .set('X-Forwarded-For', `10.7.${ipSeq++ % 250}.${ipSeq % 250}`)
    .send({
      formData: { name: 'Ama Mensah', phoneNumber: buyerPhone(), email: 'ama@example.com', address: '1 St', state: 'Greater Accra', town: 'Osu', landmark: 'Near the Total station' },
      selectedPackage: { name: 'One', price: 10, quantity: 1 },
      totalAmount: 10,
      ...extra,
    });

beforeAll(async () => {
  pair = await createTwoTenants('formpay');
  const tenantId = pair.a.id;
  ownerToken = await superAdminToken(tenantId, pair.a.slug, 'fp-owner');

  // physical form (the harness's): one package, COD + both online methods stored on
  await prismaBase.formPackage.create({ data: { formId: pair.a.ids.checkoutForm, name: 'One', price: 10, quantity: 1 } });
  await prismaBase.checkoutForm.update({
    where: { id: pair.a.ids.checkoutForm },
    data: { codEnabled: true, paystackDepositEnabled: true, paystackFullEnabled: true, depositPercent: 30 },
  });

  // a digital product with a digital form
  const product = await prismaBase.product.create({
    data: { name: 'Guide', sku: `GUIDE-${Date.now()}`, category: 'ebook', price: 10, stockQuantity: 0, productType: 'digital', tenantId },
  });
  digitalFormSlug = `digital-${pair.a.slug}`;
  const form = await prismaBase.checkoutForm.create({
    data: { name: 'Digital', slug: digitalFormSlug, productId: product.id, fields: [], styling: {}, regions: [], formType: 'digital', codEnabled: false, paystackFullEnabled: true, tenantId },
  });
  digitalFormId = form.id;
  await prismaBase.formPackage.create({ data: { formId: form.id, name: 'One', price: 10, quantity: 1 } });

  // a working Paystack connection, so the "keys added" rule passes
  await prismaBase.paymentConnection.updateMany({ where: { tenantId }, data: { secretKey: 'sk_test_formpay', publicKey: 'pk_test_formpay' } });
  clearPaymentConfigCache(tenantId);
});

afterEach(() => {
  global.fetch = originalFetch;
  clearCheckoutFormConfigCache();
});

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

const paystackInitOk = () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ status: true, data: { authorization_url: 'https://pay.test/x', access_code: 'ac', reference: `ref_${Date.now()}_${ipSeq++}` } }),
  }) as never;
};

describe('PUT /api/checkout-forms/:id', () => {
  const put = (id: number, body: Record<string, unknown>) =>
    request(app).put(`/api/checkout-forms/${id}`).set(bearer(ownerToken)).send(body);

  it('flag off: switching an online method on for a physical form is 400', async () => {
    await setFlag(false);
    await prismaBase.checkoutForm.update({ where: { id: pair.a.ids.checkoutForm }, data: { paystackDepositEnabled: false, paystackFullEnabled: false } });
    const res = await put(pair.a.ids.checkoutForm, { paystackFullEnabled: true, codEnabled: false });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Online payment is paused for physical products.');
    const stored = await prismaBase.checkoutForm.findUniqueOrThrow({ where: { id: pair.a.ids.checkoutForm } });
    expect(stored.paystackFullEnabled).toBe(false);
  });

  it('flag off: toggles that are already stored stay, and the form still saves', async () => {
    await prismaBase.checkoutForm.update({ where: { id: pair.a.ids.checkoutForm }, data: { codEnabled: true, paystackDepositEnabled: false, paystackFullEnabled: true } });
    const res = await put(pair.a.ids.checkoutForm, { codEnabled: true, paystackFullEnabled: true, name: 'Renamed' });
    expect(res.status).toBe(200);
    const stored = await prismaBase.checkoutForm.findUniqueOrThrow({ where: { id: pair.a.ids.checkoutForm } });
    expect(stored.paystackFullEnabled).toBe(true);
  });

  it('flag on: the online method can be switched on', async () => {
    await setFlag(true);
    await prismaBase.checkoutForm.update({ where: { id: pair.a.ids.checkoutForm }, data: { paystackFullEnabled: false } });
    const res = await put(pair.a.ids.checkoutForm, { paystackFullEnabled: true, codEnabled: true });
    expect(res.status).toBe(200);
  });

  it('a digital form cannot switch COD or deposit on, whatever the flag says', async () => {
    for (const flag of [false, true]) {
      await setFlag(flag);
      const cod = await put(digitalFormId, { codEnabled: true });
      expect(cod.status).toBe(400);
      expect(cod.body.message).toBe('Digital products are paid online in full.');
      const dep = await put(digitalFormId, { paystackDepositEnabled: true, depositPercent: 30 });
      expect(dep.status).toBe(400);
    }
  });
});

describe('public order route', () => {
  it('tampered request: flag off, the form still has full payment stored on, the buyer asks for it: 400', async () => {
    await setFlag(false);
    await prismaBase.checkoutForm.update({ where: { id: pair.a.ids.checkoutForm }, data: { codEnabled: true, paystackFullEnabled: true, paystackDepositEnabled: false } });
    clearCheckoutFormConfigCache();
    paystackInitOk();
    const pendingBefore = await prismaBase.pendingCheckout.count({ where: { tenantId: pair.a.id } });
    for (const method of ['online_full', 'paystack_full', 'online_deposit', 'paystack_deposit', 'made_up']) {
      const res = await order(pair.a.formSlug, { paymentMethod: method });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Selected payment method is not available for this form');
    }
    expect(global.fetch).not.toHaveBeenCalled();
    expect(await prismaBase.pendingCheckout.count({ where: { tenantId: pair.a.id } })).toBe(pendingBefore);
  });

  it('flag off: COD still works, with or without the method named', async () => {
    const named = await order(pair.a.formSlug, { paymentMethod: 'cod' });
    expect(named.status).toBe(201);
    const unnamed = await order(pair.a.formSlug);
    expect(unnamed.status).toBe(201);
    const created = await prismaBase.order.findUniqueOrThrow({ where: { id: named.body.orderId } });
    expect(created.paymentMethod).toBe('cod');
  });

  it('flag on, a method the form has switched off is still 400', async () => {
    await setFlag(true);
    await prismaBase.checkoutForm.update({ where: { id: pair.a.ids.checkoutForm }, data: { paystackDepositEnabled: false } });
    const res = await order(pair.a.formSlug, { paymentMethod: 'online_deposit' });
    expect(res.status).toBe(400);
  });

  it('flag on: the old name and the new name both work, and both store the neutral name and the provider', async () => {
    await setFlag(true);
    for (const name of ['paystack_full', 'online_full']) {
      paystackInitOk();
      const res = await order(pair.a.formSlug, { paymentMethod: name });
      expect(res.status).toBe(201);
      expect(res.body.authorization_url).toBe('https://pay.test/x');
      expect(res.body.paymentMethod).toBe('online_full');
      const pending = await prismaBase.pendingCheckout.findUniqueOrThrow({ where: { reference: res.body.paymentReference } });
      expect(pending).toMatchObject({ paymentMethod: 'online_full', provider: 'paystack', status: 'initiated' });
    }
  });

  it('digital form: full online payment is forced, even if the buyer asks for COD', async () => {
    for (const flag of [false, true]) {
      await setFlag(flag);
      paystackInitOk();
      const res = await order(digitalFormSlug, { paymentMethod: 'cod' });
      expect(res.status).toBe(201);
      expect(res.body.paymentMethod).toBe('online_full');
      expect(res.body.authorization_url).toBe('https://pay.test/x');
      expect(await prismaBase.order.count({ where: { tenantId: pair.a.id, orderType: 'digital' } })).toBe(0); // order only after payment
    }
  });
});

describe('features.prepaidPhysical setting', () => {
  const putSettings = (body: Record<string, unknown>) =>
    request(app).put('/api/admin/settings').set(bearer(ownerToken)).send(body);

  it('is off by default, can be turned on, and is merged not replaced', async () => {
    await setFlag(null);
    expect((await prismaBase.systemConfig.findFirstOrThrow({ where: { tenantId: pair.a.id } })).features).toEqual({});

    const on = await putSettings({ features: { prepaidPhysical: true } });
    expect(on.status).toBe(200);
    expect(on.body.features).toEqual({ prepaidPhysical: true });

    const other = await putSettings({ businessName: 'Renamed biz' });
    expect(other.status).toBe(200);
    expect((await prismaBase.systemConfig.findFirstOrThrow({ where: { tenantId: pair.a.id } })).features).toEqual({ prepaidPhysical: true });
  });

  it('refuses a flag that is not true or false', async () => {
    expect((await putSettings({ features: { prepaidPhysical: 'yes' } })).status).toBe(400);
    expect((await putSettings({ features: [] })).status).toBe(400);
  });

  it('is per tenant: tenant B stays off', async () => {
    const cfg = await prismaBase.systemConfig.findFirstOrThrow({ where: { tenantId: pair.b.id } });
    expect(cfg.features).toEqual({});
  });
});
