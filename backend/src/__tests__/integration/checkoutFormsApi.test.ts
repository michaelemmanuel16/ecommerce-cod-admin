/**
 * M3b-T08 (COD-33, F-408, F-411, F-412, F-413, F-416, F-422): the checkout forms API.
 * List with order counts, archive instead of delete, restore, clone, basics rules, required keys, form type,
 * regions, tracking ids, test event, and who may call what. Real DB, two tenants. Meta is never called: fetch is mocked.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { clearCheckoutFormConfigCache } from '../../services/checkoutFormService';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { bearer, superAdminToken } from './helpers/superAdminToken';

jest.setTimeout(120_000);

process.env.PROVIDER_ENCRYPTION_KEY = 'cd'.repeat(32);
const originalFetch = global.fetch;
let pair: TwoTenants;
let ownerA: string;
let ownerB: string;
let managerA: string;
let digitalProductId: number;
let seq = 0;

const FULL_FIELDS = [
  { label: 'Full Name', type: 'text', enabled: true, required: true, standardKey: 'fullName' },
  { label: 'Phone', type: 'phone', enabled: true, required: true, standardKey: 'phone' },
  { label: 'State', type: 'state', enabled: true, required: true, standardKey: 'region' },
  { label: 'City', type: 'text', enabled: true, required: true, standardKey: 'city' },
  { label: 'Street Address', type: 'textarea', enabled: true, required: true, standardKey: 'streetAddress' },
  { label: 'Notes', type: 'textarea', enabled: true, required: false, standardKey: 'notes' },
];
const NO_ADDRESS = FULL_FIELDS.filter((f) => f.standardKey !== 'streetAddress');
const DIGITAL_FIELDS = [
  { label: 'Full Name', type: 'text', enabled: true, required: true, standardKey: 'fullName' },
  { label: 'Phone', type: 'phone', enabled: true, required: true, standardKey: 'phone' },
  { label: 'Email', type: 'email', enabled: true, required: true, standardKey: 'email' },
];

const formBody = (extra: Record<string, unknown> = {}) => ({
  name: `Api form ${++seq}`,
  slug: `api-form-${pair.a.slug}-${seq}`,
  productId: pair.a.ids.product,
  fields: FULL_FIELDS,
  styling: {},
  regions: {},
  packages: [{ name: 'One', price: 10, quantity: 1 }],
  ...extra,
});
const create = (body: Record<string, unknown>, token = ownerA) => request(app).post('/api/checkout-forms').set(bearer(token)).send(body);
const put = (id: number, body: Record<string, unknown>, token = ownerA) => request(app).put(`/api/checkout-forms/${id}`).set(bearer(token)).send(body);
const stored = (id: number) => prismaBase.checkoutForm.findUniqueOrThrow({ where: { id }, include: { packages: true, upsells: true } });

/** An order of tenant A that came from a checkout form, linked to the form by a submission. */
const orderFor = async (formId: number, createdAt = new Date(), extra: Record<string, unknown> = {}) => {
  const order = await prismaBase.order.create({
    data: {
      customerId: pair.a.ids.customer, status: 'pending_confirmation', subtotal: 10, shippingCost: 0, totalAmount: 10, codAmount: 10,
      source: 'checkout_form', tenantId: pair.a.id, createdAt, ...extra,
    },
  });
  await prismaBase.formSubmission.create({
    data: { formId, orderId: order.id, formData: {}, selectedPackage: {}, totalAmount: 10, tenantId: pair.a.id },
  });
  return order;
};

beforeAll(async () => {
  pair = await createTwoTenants('cfapi');
  ownerA = await superAdminToken(pair.a.id, pair.a.slug, 'cfapi-owner');
  ownerB = await superAdminToken(pair.b.id, pair.b.slug, 'cfapi-owner');
  const manager = await prismaBase.user.create({
    data: { email: `mgr-${pair.a.slug}@codadmin.test`, password: 'x', firstName: 'Mgr', lastName: 'A', role: 'manager', tenantId: pair.a.id },
  });
  managerA = generateAccessToken({ id: manager.id, email: manager.email, role: 'manager', tenantId: pair.a.id });
  digitalProductId = (await prismaBase.product.create({
    data: { name: 'Guide', sku: `GUIDE-${Date.now()}`, category: 'ebook', price: 10, stockQuantity: 0, productType: 'digital', tenantId: pair.a.id },
  })).id;
});

afterEach(() => {
  global.fetch = originalFetch;
  clearCheckoutFormConfigCache();
});

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('create: basics, country, regions, type', () => {
  it('country comes from the store and a country in the body is ignored; a new form starts with every region of that country', async () => {
    const res = await create(formBody({ country: 'Kenya', packages: [{ name: 'One', price: 10, quantity: 1 }] }));
    expect(res.status).toBe(201);
    expect(res.body.form.country).toBe('Ghana');
    expect(res.body.form.regions.available).toHaveLength(16);
    expect(res.body.form.regions.available).toContain('Greater Accra');
    expect(res.body.form.formType).toBe('physical');

    // tenant B sells in NGN, so its country is Nigeria
    const productB = pair.b.ids.product;
    const b = await create(formBody({ slug: `api-form-b-${pair.b.slug}-${seq}`, productId: productB }), ownerB);
    expect(b.status).toBe(201);
    expect(b.body.form.country).toBe('Nigeria');
    expect(b.body.form.regions.available).toHaveLength(37);
  });

  it('update ignores a country in the body', async () => {
    const id = (await create(formBody())).body.form.id;
    const res = await put(id, { country: 'Kenya', name: 'Renamed' });
    expect(res.status).toBe(200);
    expect((await stored(id)).country).toBe('Ghana');
  });

  it('thank-you page: http is refused, https and empty are fine', async () => {
    const bad = await create(formBody({ redirectUrl: 'http://shop.example.com/thanks' }));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('Thank-you page must start with https://');
    const ok = await create(formBody({ redirectUrl: 'https://shop.example.com/thanks' }));
    expect(ok.status).toBe(201);
    expect(ok.body.form.redirectUrl).toBe('https://shop.example.com/thanks');
    expect((await create(formBody({ redirectUrl: '' }))).status).toBe(201);
    const upd = await put(ok.body.form.id, { redirectUrl: 'ftp://x.example.com' });
    expect(upd.status).toBe(400);
  });

  it('allowed domains: a bare host is stored as an https origin; http, paths and wildcards are refused and named', async () => {
    const ok = await create(formBody({ allowedOrigins: ['shop.example.com', 'https://Brand.example.com/', 'shop.example.com'] }));
    expect(ok.status).toBe(201);
    expect(ok.body.form.allowedOrigins).toEqual(['https://shop.example.com', 'https://brand.example.com']);
    for (const bad of ['http://shop.example.com', 'shop.example.com/page', '*.example.com', 'not a host']) {
      const res = await create(formBody({ allowedOrigins: ['shop.example.com', bad] }));
      expect(res.status).toBe(400);
      expect(res.body.error).toContain(`"${bad}"`);
    }
  });

  it('a form type that differs from the product type is refused; the type follows the product', async () => {
    const mismatch = await create(formBody({ formType: 'digital' }));
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toBe('Form type must match the product (digital/physical).');
    const digital = await create(formBody({ productId: digitalProductId, fields: DIGITAL_FIELDS, codEnabled: false, paystackFullEnabled: true }));
    expect(digital.status).toBe(201);
    expect(digital.body.form.formType).toBe('digital');
  });

  it('regions must be regions of the form country, and one must stay', async () => {
    const bad = await create(formBody({ regions: { available: ['Greater Accra', 'Atlantis'] } }));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toContain('Atlantis');
    expect((await create(formBody({ regions: { available: [] } }))).status).toBe(400);
    const ok = await create(formBody({ regions: { available: ['greater accra', 'Ashanti'] } }));
    expect(ok.status).toBe(201);
    expect(ok.body.form.regions.available).toEqual(['Greater Accra', 'Ashanti']);
    const id = ok.body.form.id;
    expect((await put(id, { regions: { available: ['Narnia'] } })).status).toBe(400);
    expect((await put(id, { regions: { available: ['Volta'] } })).status).toBe(200);
  });

  it('an add-on on a digital form must point at a digital product', async () => {
    const upsells = (productId: number) => [{ name: 'Extra', price: 5, productId }];
    const bad = await create(formBody({ productId: digitalProductId, fields: DIGITAL_FIELDS, codEnabled: false, paystackFullEnabled: true, upsells: upsells(pair.a.ids.product) }));
    expect(bad.status).toBe(400);
    const ok = await create(formBody({ productId: digitalProductId, fields: DIGITAL_FIELDS, codEnabled: false, paystackFullEnabled: true, upsells: upsells(digitalProductId) }));
    expect(ok.status).toBe(201);
    expect(ok.body.form.upsells[0].productId).toBe(digitalProductId);
  });
});

describe('required keys on activation', () => {
  it('a physical form without a street address cannot be active', async () => {
    const res = await create(formBody({ fields: NO_ADDRESS }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This form can't take orders yet. Add: Street address.");
    const draft = await create(formBody({ fields: NO_ADDRESS, isActive: false }));
    expect(draft.status).toBe(201);
    const id = draft.body.form.id;
    const on = await put(id, { isActive: true });
    expect(on.status).toBe(400);
    expect(on.body.message).toBe("This form can't take orders yet. Add: Street address.");
    expect((await put(id, { isActive: true, fields: FULL_FIELDS })).status).toBe(200);
  });

  it('a fields update on an active form is checked too, and a disabled field does not count', async () => {
    const id = (await create(formBody())).body.form.id;
    const off = FULL_FIELDS.map((f) => (f.standardKey === 'region' ? { ...f, enabled: false } : f));
    const res = await put(id, { fields: off });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This form can't take orders yet. Add: State.");
    expect((await stored(id)).fields).toEqual(FULL_FIELDS);
  });

  it('a digital form needs an email, not an address', async () => {
    const digital = { productId: digitalProductId, codEnabled: false, paystackFullEnabled: true };
    const noEmail = await create(formBody({ ...digital, fields: DIGITAL_FIELDS.filter((f) => f.standardKey !== 'email') }));
    expect(noEmail.status).toBe(400);
    expect(noEmail.body.error).toBe("This form can't take orders yet. Add: Email.");
    expect((await create(formBody({ ...digital, fields: DIGITAL_FIELDS }))).status).toBe(201);
  });
});

describe('type follows the product', () => {
  it('changing the product across types is refused once the form has orders, allowed before', async () => {
    const withOrders = (await create(formBody())).body.form.id;
    await orderFor(withOrders);
    const refused = await put(withOrders, { productId: digitalProductId });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('This form has orders. Its product type cannot change.');
    expect((await stored(withOrders)).formType).toBe('physical');

    const fresh = (await create(formBody({ isActive: false }))).body.form.id;
    const ok = await put(fresh, { productId: digitalProductId, formType: 'digital', codEnabled: false, paystackFullEnabled: true });
    expect(ok.status).toBe(200);
    expect((await stored(fresh)).formType).toBe('digital');
    expect((await put(fresh, { formType: 'physical' })).status).toBe(400);
  });
});

describe('list, archive, restore', () => {
  it('list: order counts for this store month and all time, archived hidden unless asked, inactive shown', async () => {
    const id = (await create(formBody({ name: 'Counted form' }))).body.form.id;
    const old = new Date(Date.now() - 70 * 24 * 3600 * 1000);
    await orderFor(id);
    await orderFor(id, old);
    await orderFor(id, new Date(), { deletedAt: new Date() }); // deleted orders do not count
    await orderFor(id, new Date(), { source: 'manual' }); // other sources do not count
    const inactive = (await create(formBody({ isActive: false, name: 'Switched off form' }))).body.form.id;

    const res = await request(app).get('/api/checkout-forms').query({ limit: 100 }).set(bearer(ownerA));
    expect(res.status).toBe(200);
    const row = res.body.forms.find((f: any) => f.id === id);
    expect(row).toMatchObject({ ordersThisMonth: 1, ordersTotal: 2, conversion: null });
    expect(res.body.forms.find((f: any) => f.id === inactive)).toMatchObject({ isActive: false, ordersTotal: 0 });
    expect(JSON.stringify(res.body)).not.toContain(pair.b.marker);
  });

  it('a form with submissions is archived, not deleted; the public form is gone; the list hides it until archived=true', async () => {
    const created = (await create(formBody())).body.form;
    await orderFor(created.id);
    await orderFor(created.id);
    const del = await request(app).delete(`/api/checkout-forms/${created.id}`).set(bearer(ownerA));
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ archived: true, ordersTotal: 2 });
    const row = await stored(created.id);
    expect(row.archivedAt).not.toBeNull();
    expect(row.isActive).toBe(false);
    expect(row.slug).toBe(created.slug);

    expect((await request(app).get(`/api/public/forms/${created.slug}`)).status).toBe(404);
    expect((await request(app).post(`/api/public/forms/${created.slug}/orders`).send({ formData: {}, selectedPackage: {} })).status).toBe(404);

    const list = await request(app).get('/api/checkout-forms').query({ limit: 100 }).set(bearer(ownerA));
    expect(list.body.forms.map((f: any) => f.id)).not.toContain(created.id);
    const archived = await request(app).get('/api/checkout-forms').query({ archived: 'true', limit: 100 }).set(bearer(ownerA));
    expect(archived.body.forms.map((f: any) => f.id)).toContain(created.id);
    expect(archived.body.forms.every((f: any) => f.archivedAt)).toBe(true);
  });

  it('a form without submissions is deleted for good, and the answer warns when it was the last active form of the product', async () => {
    const product = await prismaBase.product.create({
      data: { name: 'Solo', sku: `SOLO-${Date.now()}`, category: 'test', price: 5, stockQuantity: 5, tenantId: pair.a.id },
    });
    const created = (await create(formBody({ productId: product.id }))).body.form;
    const del = await request(app).delete(`/api/checkout-forms/${created.id}`).set(bearer(ownerA));
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ deleted: true, warning: 'No active form sells this product.' });
    expect(await prismaBase.checkoutForm.findUnique({ where: { id: created.id } })).toBeNull();
    expect(await prismaBase.formPackage.count({ where: { formId: created.id } })).toBe(0);
  });

  it('restore clears archivedAt and leaves the form inactive; a form that is not archived is 404; tenant B cannot restore it', async () => {
    const created = (await create(formBody())).body.form;
    expect((await request(app).post(`/api/checkout-forms/${created.id}/restore`).set(bearer(ownerA))).status).toBe(404);
    await orderFor(created.id);
    await request(app).delete(`/api/checkout-forms/${created.id}`).set(bearer(ownerA));

    expect((await request(app).post(`/api/checkout-forms/${created.id}/restore`).set(bearer(ownerB))).status).toBe(404);
    expect((await stored(created.id)).archivedAt).not.toBeNull();

    // an archived form cannot be switched on by the active switch
    expect((await put(created.id, { isActive: true })).status).toBe(400);

    const res = await request(app).post(`/api/checkout-forms/${created.id}/restore`).set(bearer(ownerA));
    expect(res.status).toBe(200);
    const row = await stored(created.id);
    expect(row.archivedAt).toBeNull();
    expect(row.isActive).toBe(false);
    expect((await put(created.id, { isActive: true })).status).toBe(200);
  });

  it('a call rep and a manager cannot delete, restore or clone', async () => {
    const id = (await create(formBody())).body.form.id;
    for (const token of [pair.a.users.salesRep.token, managerA]) {
      expect((await request(app).delete(`/api/checkout-forms/${id}`).set(bearer(token))).status).toBe(403);
      expect((await request(app).post(`/api/checkout-forms/${id}/restore`).set(bearer(token))).status).toBe(403);
      expect((await request(app).post(`/api/checkout-forms/${id}/clone`).set(bearer(token))).status).toBe(403);
    }
  });
});

describe('clone', () => {
  it('copies the form into an inactive "(copy)" with a free slug, without the Conversion API token', async () => {
    const source = (await create(formBody({
      name: 'Clone me',
      pixelConfig: { facebookPixelId: '123456789' },
      metaCapiAccessToken: 'EAAB-secret-token',
      metaCapiTestEventCode: 'TEST123',
      redirectUrl: 'https://shop.example.com/thanks',
      allowedOrigins: ['shop.example.com'],
      design: { colors: { primary: '#112233' } },
      packages: [{ name: 'One', price: 10, quantity: 1 }, { name: 'Two', price: 18, quantity: 2, isDefault: true }],
      upsells: [{ name: 'Extra', price: 5, productId: pair.a.ids.product }],
    }))).body.form;
    expect(source.id).toBeDefined();

    const res = await request(app).post(`/api/checkout-forms/${source.id}/clone`).set(bearer(ownerA));
    expect(res.status).toBe(201);
    expect(res.body.capiTokenNotCopied).toBe(true);
    const copy = await stored(res.body.form.id);
    expect(copy.name).toBe('Clone me (copy)');
    expect(copy.slug).toBe('clone-me-copy');
    expect(copy.isActive).toBe(false);
    expect(copy.archivedAt).toBeNull();
    expect(copy.metaCapiAccessToken).toBeNull();
    expect(copy.metaCapiTestEventCode).toBeNull();
    expect(copy.pixelConfig).toEqual({ facebookPixelId: '123456789' });
    expect(copy.redirectUrl).toBe('https://shop.example.com/thanks');
    expect(copy.allowedOrigins).toEqual(['https://shop.example.com']);
    expect(copy.design).toEqual((await stored(source.id)).design);
    expect(copy.design).not.toBeNull();
    expect(copy.fields).toEqual(FULL_FIELDS);
    expect(copy.packages.map((p) => [p.name, Number(p.price), p.quantity, p.isDefault]).sort()).toEqual([['One', 10, 1, false], ['Two', 18, 2, true]]);
    expect(copy.upsells.map((u) => [u.name, Number(u.price), u.productId])).toEqual([['Extra', 5, pair.a.ids.product]]);
    expect(JSON.stringify(res.body)).not.toContain('EAAB-secret-token');

    // a second copy of the same form takes the next free slug; so does a copy of the copy's archived namesake
    const again = await request(app).post(`/api/checkout-forms/${source.id}/clone`).set(bearer(ownerA));
    expect(again.body.form.slug).toBe('clone-me-copy-2');
    expect(again.body.capiTokenNotCopied).toBe(true);
    await prismaBase.checkoutForm.update({ where: { id: copy.id }, data: { archivedAt: new Date() } });
    const third = await request(app).post(`/api/checkout-forms/${copy.id}/clone`).set(bearer(ownerA)); // cloning an archived form is allowed
    expect(third.status).toBe(201);
    expect(third.body.form.slug).toBe('clone-me-copy-copy');
  });

  it('a source without a token says so, and tenant B cannot clone tenant A\'s form', async () => {
    const source = (await create(formBody({ name: 'Plain' }))).body.form;
    const ok = await request(app).post(`/api/checkout-forms/${source.id}/clone`).set(bearer(ownerA));
    expect(ok.body.capiTokenNotCopied).toBe(false);
    const other = await request(app).post(`/api/checkout-forms/${source.id}/clone`).set(bearer(ownerB));
    expect(other.status).toBe(404);
    expect(await prismaBase.checkoutForm.count({ where: { tenantId: pair.b.id, name: 'Plain (copy)' } })).toBe(0);
  });
});

describe('tracking', () => {
  it('pixel ids are checked: digits, G-, GTM-; empty is fine', async () => {
    const bad = (pixelConfig: Record<string, string>) => create(formBody({ pixelConfig }));
    expect((await bad({ facebookPixelId: '12ab' })).status).toBe(400);
    expect((await bad({ googleAnalyticsId: 'UA-1' })).status).toBe(400);
    expect((await bad({ googleTagManagerId: 'G-1' })).status).toBe(400);
    const ok = await create(formBody({ pixelConfig: { facebookPixelId: '123', googleAnalyticsId: 'G-AB12', googleTagManagerId: 'GTM-AB12', tiktokPixelId: '' } }));
    expect(ok.status).toBe(201);
    expect((await put(ok.body.form.id, { pixelConfig: { facebookPixelId: 'abc' } })).status).toBe(400);
    expect((await put(ok.body.form.id, { pixelConfig: { facebookPixelId: '' } })).status).toBe(200);
  });

  it('the Conversion API token is never returned', async () => {
    const res = await create(formBody({ metaCapiAccessToken: 'EAAB-never-shown' }));
    expect(JSON.stringify(res.body)).not.toContain('EAAB-never-shown');
    const read = await request(app).get(`/api/checkout-forms/${res.body.form.id}`).set(bearer(ownerA));
    expect(JSON.stringify(read.body)).not.toContain('EAAB-never-shown');
  });

  it('test event: 400 without a token and a test code; with them, Meta gets the test code and its answer comes back', async () => {
    const id = (await create(formBody({ pixelConfig: { facebookPixelId: '555666777' } }))).body.form.id;
    const none = await request(app).post(`/api/checkout-forms/${id}/test-event`).set(bearer(ownerA));
    expect(none.status).toBe(400);
    expect(none.body.error).toBe('Add a Conversion API token and a test event code first.');
    await put(id, { metaCapiAccessToken: 'EAAB-test-token' });
    expect((await request(app).post(`/api/checkout-forms/${id}/test-event`).set(bearer(ownerA))).status).toBe(400);

    await put(id, { metaCapiTestEventCode: 'TEST4242' });
    const metaAnswer = { events_received: 1, messages: [], fbtrace_id: 'trace' };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => metaAnswer }) as never;
    const res = await request(app).post(`/api/checkout-forms/${id}/test-event`).set(bearer(ownerA));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, status: 200, metaResponse: metaAnswer });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, { body: string }];
    expect(url).toContain('/555666777/events');
    expect(url).toContain('EAAB-test-token');
    const sent = JSON.parse(init.body);
    expect(sent.test_event_code).toBe('TEST4242');
    expect(sent.data[0].event_name).toBe('Purchase');
    expect(JSON.stringify(res.body)).not.toContain('EAAB-test-token');

    // Meta refusing the event is passed on, not hidden
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'Invalid token' } }) }) as never;
    const refused = await request(app).post(`/api/checkout-forms/${id}/test-event`).set(bearer(ownerA));
    expect(refused.body).toEqual({ ok: false, status: 400, metaResponse: { error: { message: 'Invalid token' } } });

    // another tenant's form is not reachable
    expect((await request(app).post(`/api/checkout-forms/${id}/test-event`).set(bearer(ownerB))).status).toBe(404);
  });
});

describe('who may call what', () => {
  it('preview: manager 200, call rep 403', async () => {
    const id = (await create(formBody({ isActive: false }))).body.form.id;
    const manager = await request(app).get(`/api/checkout-forms/${id}/preview-config`).set(bearer(managerA));
    expect(manager.status).toBe(200);
    expect(manager.body.form.id).toBe(id);
    expect((await request(app).get(`/api/checkout-forms/${id}/preview-config`).set(bearer(pair.a.users.salesRep.token))).status).toBe(403);
  });
});

describe('regions route', () => {
  it('works without a token when a country is named, by name or code, and is cached', async () => {
    const byName = await request(app).get('/api/reference/regions').query({ country: 'Ghana' });
    expect(byName.status).toBe(200);
    expect(byName.body.country).toBe('GH');
    expect(byName.body.regions).toHaveLength(16);
    expect(byName.headers['cache-control']).toBe('public, max-age=86400');
    expect((await request(app).get('/api/reference/regions').query({ country: 'ng' })).body.regions).toHaveLength(37);
  });

  it('without a country it uses the store country of a valid token; with neither it is a 400', async () => {
    const none = await request(app).get('/api/reference/regions');
    expect(none.status).toBe(400);
    expect(none.body.error).toBe('country is required');
    expect((await request(app).get('/api/reference/regions').set(bearer(ownerA))).body.country).toBe('GH');
    expect((await request(app).get('/api/reference/regions').set(bearer(ownerB))).body.country).toBe('NG');
    expect((await request(app).get('/api/reference/regions').set('Authorization', 'Bearer nonsense')).status).toBe(400);
  });
});

describe('order fields: city, region and notes', () => {
  const buyer = (extra: Record<string, unknown> = {}) => ({
    name: 'Ama Mensah', phoneNumber: `+23324${String(Date.now()).slice(-6)}${seq++ % 10}`, address: '1 Ring Road', state: 'Greater Accra', landmark: 'Near the Total station', ...extra,
  });
  const orderOn = (slug: string, formData: Record<string, unknown>) =>
    request(app).post(`/api/public/forms/${slug}/orders`).set('X-Forwarded-For', `10.9.${seq % 250}.${(seq * 7) % 250}`)
      .send({ formData, selectedPackage: { name: 'One', price: 10, quantity: 1 }, totalAmount: 10 });

  it('city fills the delivery area and the customer area, region fills the state, notes fill the order notes', async () => {
    const form = (await create(formBody({ regions: { available: ['Greater Accra', 'Ashanti'] } }))).body.form;
    const res = await orderOn(form.slug, buyer({ city: 'Osu', notes: 'Call before you come' }));
    expect(res.status).toBe(201);
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: res.body.orderId }, include: { customer: true } });
    expect(order).toMatchObject({ deliveryArea: 'Osu', deliveryState: 'Greater Accra', notes: 'Call before you come' });
    expect(order.customer).toMatchObject({ area: 'Osu', state: 'Greater Accra' });
  });

  it('a form with no city field puts the region in the town', async () => {
    const fields = FULL_FIELDS.map((f) => (f.standardKey === 'city' ? { ...f, enabled: false } : f));
    const form = (await create(formBody({ fields }))).body.form;
    const res = await orderOn(form.slug, buyer({ state: 'Ashanti' }));
    expect(res.status).toBe(201);
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: res.body.orderId }, include: { customer: true } });
    expect(order.deliveryArea).toBe('Ashanti');
    expect(order.customer.area).toBe('Ashanti');
  });
});

describe('static check: one regions list', () => {
  const GH = ['Greater Accra', 'Ashanti', 'Western', 'Eastern', 'Volta', 'Central', 'Northern', 'Upper East', 'Upper West', 'Bono', 'Oti', 'Savannah', 'Ahafo', 'North East', 'Western North', 'Bono East'];
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['__tests__', 'node_modules', 'migrations', 'fixtures', 'data', 'dist', 'e2e'].includes(entry.name)) walk(full, out);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) out.push(full);
    }
    return out;
  };

  it('no source file spells out three or more Ghana regions in one place', () => {
    const roots = [path.resolve(__dirname, '../../'), path.resolve(__dirname, '../../../../frontend/src')];
    const files = roots.flatMap((root) => walk(root));
    expect(files.some((f) => f.endsWith(path.join('utils', 'regions.ts')))).toBe(true); // the scan reaches backend and frontend sources
    expect(files.some((f) => f.includes(path.join('frontend', 'src')))).toBe(true);
    const offenders = files.filter((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return text.split(/\n\s*\n|\]/).some((chunk) => GH.filter((name) => chunk.includes(`'${name}'`) || chunk.includes(`"${name}"`)).length >= 3);
    });
    expect(offenders.map((f) => path.relative(path.resolve(__dirname, '../../../..'), f))).toEqual([]);
  });
});
