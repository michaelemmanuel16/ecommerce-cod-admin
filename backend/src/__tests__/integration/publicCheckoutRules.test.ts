/**
 * M3b-T09 (COD-33, F-420, F-414, F-415): the server rules of the public checkout.
 * Sold out, region from the form list, prices from the server, add-ons that are out of stock, the duplicate guard
 * on the server total, and the order number in the answer. Real DB; the Meta call is spied on, never made.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, jest } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { metaCapiService } from '../../services/metaCapiService';
import { clearCheckoutFormConfigCache } from '../../services/checkoutFormService';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

jest.setTimeout(120_000);

let pair: TwoTenants;
let tenantId: string;
let seq = 0;
let ipSeq = 1;
let capiSpy: jest.SpiedFunction<typeof metaCapiService.fireCapiPurchaseEvent>;

let stockedProductId: number;
let upsells: { manual: number; inStock: number; outOfStock: number; inactive: number };
let mainSlug: string;
let mainFormId: number;
let packages: { one: number; two: number };

const product = (data: Record<string, unknown>) =>
  prismaBase.product.create({
    data: { name: `P${++seq}`, sku: `T09-${Date.now()}-${seq}`, category: 'test', price: 10, stockQuantity: 10, tenantId, ...data } as never,
  });

const makeForm = async (productId: number, extra: Record<string, unknown> = {}) => {
  const slug = `t09-${pair.a.slug}-${++seq}`;
  const form = await prismaBase.checkoutForm.create({
    data: { name: slug, slug, productId, fields: [], styling: {}, regions: { available: ['Greater Accra', 'Ashanti'] }, tenantId, ...extra } as never,
  });
  await prismaBase.formPackage.create({ data: { formId: form.id, name: 'One', price: 10, quantity: 1 } });
  return form;
};

const phone = () => `+23324${String(Date.now()).slice(-6)}${seq++ % 10}`;
const buyer = (extra: Record<string, unknown> = {}) => ({
  name: 'Ama Mensah', phoneNumber: phone(), state: 'Greater Accra', town: 'Osu', landmark: 'Near the Total station', ...extra,
});
const place = (slug: string, body: Record<string, unknown>, ip = `10.8.${ipSeq++ % 250}.${(ipSeq * 3) % 250}`) =>
  // The route insists on a package name, price and quantity and a total; the server ignores all of them, so default them.
  request(app).post(`/api/public/forms/${slug}/orders`).set('X-Forwarded-For', ip)
    .send({ totalAmount: 1, ...body, selectedPackage: { name: 'One', price: 1, quantity: 1, ...(body.selectedPackage as object) } });

beforeAll(async () => {
  pair = await createTwoTenants('t09');
  tenantId = pair.a.id;
  const stocked = await product({ stockQuantity: 10 });
  stockedProductId = stocked.id;
  const out = await product({ stockQuantity: 0 });
  const off = await product({ stockQuantity: 10, isActive: false });
  const main = await makeForm(stocked.id);
  mainFormId = main.id;
  mainSlug = main.slug;
  const pkgs = await prismaBase.formPackage.findMany({ where: { formId: main.id } });
  const two = await prismaBase.formPackage.create({ data: { formId: main.id, name: 'Two', price: 18, quantity: 2 } });
  packages = { one: pkgs[0].id, two: two.id };
  const upsell = (name: string, price: number, productId: number | null) =>
    prismaBase.formUpsell.create({ data: { formId: main.id, name, price, productId } }).then((u) => u.id);
  upsells = {
    manual: await upsell('Manual extra', 5, null),
    inStock: await upsell('In stock extra', 7, stocked.id),
    outOfStock: await upsell('Out of stock extra', 9, out.id),
    inactive: await upsell('Inactive extra', 11, off.id),
  };
});

beforeEach(() => {
  capiSpy = jest.spyOn(metaCapiService, 'fireCapiPurchaseEvent').mockResolvedValue(undefined);
});

afterEach(() => {
  capiSpy.mockRestore();
  clearCheckoutFormConfigCache();
});

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('sold out', () => {
  it('a physical product with no stock, or switched off, is "This product is sold out"', async () => {
    const out = await product({ stockQuantity: 0 });
    const off = await product({ isActive: false });
    for (const p of [out, off]) {
      const form = await makeForm(p.id);
      const res = await place(form.slug, { formData: buyer(), selectedPackage: { name: 'One' } });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'This product is sold out' });
    }
    expect(await prismaBase.order.count({ where: { tenantId, source: 'checkout_form', orderItems: { some: { productId: { in: [out.id, off.id] } } } } })).toBe(0);
  });

  it('a product with stock takes the order', async () => {
    const res = await place(mainSlug, { formData: buyer(), selectedPackage: { id: packages.one } });
    expect(res.status).toBe(201);
  });

  it('a digital product needs no stock, but must be on', async () => {
    const digital = await product({ productType: 'digital', stockQuantity: 0, isActive: false });
    const form = await makeForm(digital.id, { formType: 'digital', codEnabled: false, paystackFullEnabled: true });
    const res = await place(form.slug, { formData: buyer({ email: 'ama@example.com' }), selectedPackage: { name: 'One' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Product is no longer available');
  });
});

describe('region', () => {
  it('a region that is not on the form list is refused', async () => {
    const res = await place(mainSlug, { formData: buyer({ state: 'Volta' }), selectedPackage: { id: packages.one } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Choose a region from the list.');
  });

  it('the match ignores case and the list spelling is stored', async () => {
    const res = await place(mainSlug, { formData: buyer({ state: 'ASHANTI' }), selectedPackage: { id: packages.one } });
    expect(res.status).toBe(201);
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: res.body.orderId }, include: { customer: true } });
    expect(order.deliveryState).toBe('Ashanti');
    expect(order.customer.state).toBe('Ashanti');
  });
});

describe('prices come from the server', () => {
  it('a tampered package price and a tampered total are ignored', async () => {
    const res = await place(mainSlug, {
      formData: buyer(),
      selectedPackage: { id: packages.two, name: 'Two', price: 1, quantity: 99 },
      selectedUpsells: [{ id: upsells.manual, price: 0 }],
      totalAmount: 1,
    });
    expect(res.status).toBe(201);
    const order = await prismaBase.order.findUniqueOrThrow({ where: { id: res.body.orderId }, include: { orderItems: true } });
    expect(Number(order.totalAmount)).toBe(23); // 18 + 5, as the form stores them
    expect(Number(res.body.order.totalAmount)).toBe(23);
    const pkg = order.orderItems.find((i) => i.itemType === 'package');
    expect(pkg).toMatchObject({ quantity: 2 });
    expect(Number(pkg!.totalPrice)).toBe(18);
  });

  it('the answer carries the order number', async () => {
    const res = await place(mainSlug, { formData: buyer(), selectedPackage: { id: packages.one } });
    expect(res.status).toBe(201);
    expect(res.body.orderNumber).toBe(`#${res.body.orderId}`);
    expect(res.body.order.totalAmount).toBeDefined();
  });
});

describe('add-ons', () => {
  it('the public form hides an add-on whose product is out of stock or off, and keeps manual ones; nothing leaks', async () => {
    const res = await request(app).get(`/api/public/forms/${mainSlug}`);
    expect(res.status).toBe(200);
    const names = res.body.form.upsells.map((u: any) => u.name).sort();
    expect(names).toEqual(['In stock extra', 'Manual extra']);
    expect(JSON.stringify(res.body.form.upsells)).not.toMatch(/stockQuantity|productId|"product"/);
  });

  it('an add-on that is not shown cannot be bought', async () => {
    for (const hidden of [upsells.outOfStock, upsells.inactive]) {
      const res = await place(mainSlug, { formData: buyer(), selectedPackage: { id: packages.one }, selectedUpsells: [{ id: hidden }] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Selected add-on is not available');
    }
  });

  it('add-on lines are saved as upsell items and no stock moves at creation', async () => {
    const before = await prismaBase.product.findUniqueOrThrow({ where: { id: stockedProductId } });
    const res = await place(mainSlug, {
      formData: buyer(),
      selectedPackage: { id: packages.one },
      selectedUpsells: [{ id: upsells.manual }, { id: upsells.inStock }],
    });
    expect(res.status).toBe(201);
    const items = await prismaBase.orderItem.findMany({ where: { orderId: res.body.orderId }, orderBy: { id: 'asc' } });
    expect(items.map((i) => i.itemType)).toEqual(['package', 'upsell', 'upsell']);
    expect(Number((await prismaBase.order.findUniqueOrThrow({ where: { id: res.body.orderId } })).totalAmount)).toBe(22); // 10 + 5 + 7
    const after = await prismaBase.product.findUniqueOrThrow({ where: { id: stockedProductId } });
    expect(after.stockQuantity).toBe(before.stockQuantity);
  });
});

describe('duplicate guard', () => {
  const body = (phoneNumber: string, extra: Record<string, unknown> = {}) => ({ formData: buyer({ phoneNumber }), selectedPackage: { id: packages.one }, ...extra });

  it('the same buyer, package and server total within 30 minutes gets the same order, with no new order and no Meta event', async () => {
    const p = phone();
    const first = await place(mainSlug, body(p, { totalAmount: 999 }), '10.79.0.1');
    expect(first.status).toBe(201);
    const ordersBefore = await prismaBase.order.count({ where: { tenantId, source: 'checkout_form' } });
    const calls = capiSpy.mock.calls.length;

    // a different client total changes nothing: the server total decides. Same address, a local-style number for the same phone.
    const second = await place(mainSlug, body(p.replace('+233', '0'), { totalAmount: 1 }), '10.79.0.1');
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ success: true, orderId: first.body.orderId, orderNumber: first.body.orderNumber, deduplicated: true });
    expect(await prismaBase.order.count({ where: { tenantId, source: 'checkout_form' } })).toBe(ordersBefore);
    expect(capiSpy.mock.calls.length).toBe(calls);
  });

  it('another address that knows the phone gets a plain success: no order id, no new order, no Meta event', async () => {
    const p = phone();
    const first = await place(mainSlug, body(p), '10.78.0.1');
    const ordersBefore = await prismaBase.order.count({ where: { tenantId, source: 'checkout_form' } });
    const calls = capiSpy.mock.calls.length;
    const other = await place(mainSlug, body(p), '10.78.0.2');
    expect(other.status).toBe(201);
    expect(other.body).toEqual({ success: true, message: 'Order created successfully', deduplicated: true });
    expect(await prismaBase.order.count({ where: { tenantId, source: 'checkout_form' } })).toBe(ordersBefore);
    expect(capiSpy.mock.calls.length).toBe(calls);
    expect(JSON.stringify(other.body)).not.toContain(String(first.body.orderId));
  });

  it('a double tap from the same address gets the order, not a wait message', async () => {
    const p = phone();
    const first = await place(mainSlug, body(p), '10.77.0.1');
    const second = await place(mainSlug, body(p), '10.77.0.1');
    expect(second.status).toBe(201);
    expect(second.body.orderId).toBe(first.body.orderId);
  });

  it('a different package, a different server total or an order older than 30 minutes is not a duplicate', async () => {
    const p = phone();
    const first = await place(mainSlug, body(p));
    const otherPackage = await place(mainSlug, { formData: buyer({ phoneNumber: p }), selectedPackage: { id: packages.two } });
    expect(otherPackage.body.orderId).not.toBe(first.body.orderId);
    const withExtra = await place(mainSlug, { formData: buyer({ phoneNumber: p }), selectedPackage: { id: packages.one }, selectedUpsells: [{ id: upsells.manual }] });
    expect(withExtra.body.orderId).not.toBe(first.body.orderId);
    await prismaBase.order.update({ where: { id: first.body.orderId }, data: { createdAt: new Date(Date.now() - 31 * 60 * 1000) } });
    const later = await place(mainSlug, body(p));
    expect(later.status).toBe(201);
    expect(later.body.orderId).not.toBe(first.body.orderId);
    expect(later.body.deduplicated).toBeUndefined();
  });

  it('another store\'s order for the same phone and total is not a duplicate', async () => {
    const p = phone();
    const customerB = await prismaBase.customer.create({
      data: { firstName: 'B', lastName: 'Buyer', phoneNumber: p, address: 'x', state: 'Ashanti', area: 'x', tenantId: pair.b.id },
    });
    await prismaBase.order.create({
      data: {
        customerId: customerB.id, status: 'pending_confirmation', subtotal: 10, shippingCost: 0, totalAmount: 10, codAmount: 10,
        source: 'checkout_form', tenantId: pair.b.id,
        orderItems: { create: [{ productId: pair.b.ids.product, quantity: 1, unitPrice: 10, totalPrice: 10, itemType: 'package', metadata: { packageId: packages.one } }] },
      },
    });
    const res = await place(mainSlug, body(p));
    expect(res.status).toBe(201);
    expect(res.body.deduplicated).toBeUndefined();
    expect((await prismaBase.order.findUniqueOrThrow({ where: { id: res.body.orderId } })).tenantId).toBe(tenantId);
  });
});

describe('form and product switches', () => {
  it('an inactive or archived form is "Form not found" for both the page and the order', async () => {
    const form = await makeForm(stockedProductId, { isActive: false });
    const archived = await makeForm(stockedProductId, { isActive: false, archivedAt: new Date() });
    for (const slug of [form.slug, archived.slug]) {
      expect((await request(app).get(`/api/public/forms/${slug}`)).status).toBe(404);
      const res = await place(slug, { formData: buyer(), selectedPackage: { name: 'One' } });
      expect(res.status).toBe(404);
    }
    expect(mainFormId).toBeGreaterThan(0);
  });
});
