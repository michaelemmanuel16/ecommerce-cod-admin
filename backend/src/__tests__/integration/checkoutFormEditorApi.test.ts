/**
 * M3b-T12, T13 (COD-35, F-415, F-402, F-401): the two read routes of the form editor.
 *   GET /api/checkout-forms/payment-options  the prepaid-physical switch and the payment account's state, never a key
 *   GET /api/checkout-forms/:id/upsell-stats orders of the form and, per upsell, the orders that contain it
 * Real DB, two tenants. Nothing here calls Meta or a payment provider.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';
import { encryptString } from '../../utils/providerCrypto';
import { clearTenantFeaturesCache } from '../../services/tenantFeatures';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { bearer, superAdminToken } from './helpers/superAdminToken';

jest.setTimeout(120_000);

process.env.PROVIDER_ENCRYPTION_KEY = 'ef'.repeat(32);
const SECRET = 'sk_test_EDITOR_secret_value';
let pair: TwoTenants;
let ownerA: string;
let ownerB: string;
let managerA: string;
let repA: string;
let formA: number;
let formB: number;
let upPens: number;
let upGrip: number;
let upTwin1: number;
let upTwin2: number;

const get = (path: string, token = ownerA) => request(app).get(`/api/checkout-forms${path}`).set(bearer(token));

/** An order of one tenant that came from a form, with upsell lines (id and name as the public order stores them). */
async function order(side: 'a' | 'b', formId: number, lines: Array<{ upsellId: number; name: string }>, extra: Record<string, unknown> = {}) {
  const t = pair[side];
  const o = await prismaBase.order.create({
    data: {
      customerId: t.ids.customer, status: 'pending_confirmation', subtotal: 10, shippingCost: 0, totalAmount: 10, codAmount: 10,
      source: 'checkout_form', tenantId: t.id, ...extra,
    },
  });
  await prismaBase.formSubmission.create({ data: { formId, orderId: o.id, formData: {}, selectedPackage: {}, totalAmount: 10, tenantId: t.id } });
  for (const l of lines) {
    await prismaBase.orderItem.create({
      data: {
        orderId: o.id, productId: t.ids.product, quantity: 1, unitPrice: 5, totalPrice: 5, itemType: 'upsell',
        metadata: { upsellId: String(l.upsellId), upsellName: l.name },
      },
    });
  }
  return o;
}

beforeAll(async () => {
  pair = await createTwoTenants('cfeditor');
  // The seed gives each tenant a payment connection; these tests set up their own.
  await prismaBase.paymentConnection.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
  ownerA = await superAdminToken(pair.a.id, pair.a.slug, 'cfed-owner');
  ownerB = await superAdminToken(pair.b.id, pair.b.slug, 'cfed-owner');
  const mk = (role: string) =>
    prismaBase.user.create({ data: { email: `${role}-${pair.a.slug}@codadmin.test`, password: 'x', firstName: role, lastName: 'A', role: role as never, tenantId: pair.a.id } });
  const manager = await mk('manager');
  managerA = generateAccessToken({ id: manager.id, email: manager.email, role: 'manager', tenantId: pair.a.id });
  const rep = await mk('sales_rep');
  repA = generateAccessToken({ id: rep.id, email: rep.email, role: 'sales_rep', tenantId: pair.a.id });

  const form = (t: 'a' | 'b') =>
    prismaBase.checkoutForm.create({
      data: { name: `Editor ${t}`, slug: `editor-${t}-${pair[t].slug}`, productId: pair[t].ids.product, fields: [], styling: {}, regions: {}, tenantId: pair[t].id, isActive: true, country: 'Ghana', currency: 'GHS' },
    });
  formA = (await form('a')).id;
  formB = (await form('b')).id;
  const up = (formId: number, name: string) =>
    prismaBase.formUpsell.create({ data: { formId, name, price: 40, items: { quantity: 1 } } }).then((r) => r.id);
  upPens = await up(formA, 'Refill pens');
  upGrip = await up(formA, 'Grip trainer');
  upTwin1 = await up(formA, 'Twin');
  upTwin2 = await up(formA, 'Twin');
});

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('GET /payment-options', () => {
  it('is not read as a form id, and answers the default flag with no connection', async () => {
    const res = await get('/payment-options');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ prepaidPhysical: false, connection: null });
  });

  it('reports the flag and the connection state, and never a key', async () => {
    await prismaBase.systemConfig.upsert({
      where: { tenantId: pair.a.id },
      update: { features: { prepaidPhysical: true } },
      create: { tenantId: pair.a.id, features: { prepaidPhysical: true } } as never,
    });
    clearTenantFeaturesCache(pair.a.id);
    const checked = new Date('2026-10-01T10:00:00.000Z');
    await prismaBase.paymentConnection.create({
      data: {
        tenantId: pair.a.id, provider: 'paystack', mode: 'test', publicKey: 'pk_test_PUBLIC_VALUE', secretKey: encryptString(SECRET),
        isEnabled: true, supportedCurrencies: ['NGN', 'GHS'], lastCheckedAt: checked,
      },
    });

    const res = await get('/payment-options');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      prepaidPhysical: true,
      connection: { provider: 'paystack', mode: 'test', isEnabled: true, supportedCurrencies: ['NGN', 'GHS'], lastCheckedAt: checked.toISOString() },
    });
    const text = JSON.stringify(res.body);
    for (const leak of [SECRET, 'pk_test_PUBLIC_VALUE', 'secretKey', 'publicKey', 'secret', 'sk_test']) expect(text).not.toContain(leak);
    expect(Object.keys(res.body.connection).sort()).toEqual(['isEnabled', 'lastCheckedAt', 'mode', 'provider', 'supportedCurrencies']);
  });

  it('is per tenant: tenant B sees its own state, not A\'s', async () => {
    const before = await get('/payment-options', ownerB);
    expect(before.body).toEqual({ prepaidPhysical: false, connection: null });
    await prismaBase.paymentConnection.create({
      data: { tenantId: pair.b.id, provider: 'paystack', mode: 'live', publicKey: 'pk_live_B', secretKey: encryptString('sk_live_B_secret'), supportedCurrencies: ['NGN'] },
    });
    const res = await get('/payment-options', ownerB);
    expect(res.body).toEqual({ prepaidPhysical: false, connection: { provider: 'paystack', mode: 'live', isEnabled: true, supportedCurrencies: ['NGN'], lastCheckedAt: null } });
    expect(JSON.stringify(res.body)).not.toContain('sk_live_B_secret');
  });

  it('owner, admin and manager may read it; a sales rep may not; no login is refused', async () => {
    expect((await get('/payment-options', managerA)).status).toBe(200);
    expect((await get('/payment-options', repA)).status).toBe(403);
    expect((await request(app).get('/api/checkout-forms/payment-options')).status).toBe(401);
  });
});

describe('GET /:id/upsell-stats', () => {
  it('counts the form\'s orders and, per upsell, the orders that contain it', async () => {
    await order('a', formA, [{ upsellId: upPens, name: 'Refill pens' }]);
    await order('a', formA, [{ upsellId: upPens, name: 'Refill pens' }, { upsellId: upGrip, name: 'Grip trainer' }]);
    await order('a', formA, []);
    // An order placed before the last save: the upsell id is gone, the name still matches.
    await order('a', formA, [{ upsellId: 999999, name: 'Refill pens' }]);
    // A deleted order and an order of another source do not count.
    await order('a', formA, [{ upsellId: upPens, name: 'Refill pens' }], { deletedAt: new Date() });

    const res = await get(`/${formA}/upsell-stats`);
    expect(res.status).toBe(200);
    expect(res.body.ordersTotal).toBe(4);
    const by = Object.fromEntries(res.body.upsells.map((u: { upsellId: number; orders: number }) => [u.upsellId, u.orders]));
    expect(by[upPens]).toBe(3);
    expect(by[upGrip]).toBe(1);
  });

  it('gives no entry to upsells whose name is shared with another upsell of the form', async () => {
    await order('a', formA, [{ upsellId: upTwin1, name: 'Twin' }]);
    const res = await get(`/${formA}/upsell-stats`);
    const ids = res.body.upsells.map((u: { upsellId: number }) => u.upsellId);
    expect(ids).toContain(upPens);
    expect(ids).not.toContain(upTwin1);
    expect(ids).not.toContain(upTwin2);
  });

  it('never counts across tenants', async () => {
    await order('b', formB, [{ upsellId: 1, name: 'Refill pens' }]);
    const a = await get(`/${formA}/upsell-stats`);
    const b = await get(`/${formB}/upsell-stats`, ownerB);
    expect(b.status).toBe(200);
    expect(b.body.ordersTotal).toBe(1);
    expect(b.body.upsells).toEqual([]);
    // A's counts are unchanged by B's order that carries the same upsell name.
    expect(a.body.upsells.find((u: { upsellId: number }) => u.upsellId === upPens).orders).toBe(3);
    // Each owner gets 404 for the other's form.
    expect((await get(`/${formB}/upsell-stats`)).status).toBe(404);
    expect((await get(`/${formA}/upsell-stats`, ownerB)).status).toBe(404);
  });

  it('a manager may read it; a sales rep may not', async () => {
    expect((await get(`/${formA}/upsell-stats`, managerA)).status).toBe(200);
    expect((await get(`/${formA}/upsell-stats`, repA)).status).toBe(403);
  });

  it('answers 400 for a bad id', async () => {
    expect((await get('/abc/upsell-stats')).status).toBe(400);
  });
});

describe('upsells saved by the editor (F-415)', () => {
  it('keeps the discount, and the popular flag and off switch in items; an off upsell is hidden on the public form', async () => {
    const put = await request(app).put(`/api/checkout-forms/${formA}`).set(bearer(ownerA)).send({
      packages: [{ name: 'One', price: 10, quantity: 1 }],
      upsells: [
        { name: 'On pens', price: 30, originalPrice: 40, discountType: 'fixed', discountValue: 10, items: { quantity: 2, popular: true } },
        { name: 'Off grip', price: 35, items: { quantity: 1, off: true } },
      ],
    });
    expect(put.status).toBe(200);

    const rows = await prismaBase.formUpsell.findMany({ where: { formId: formA }, orderBy: { sortOrder: 'asc' } });
    expect(rows.map((r) => r.name)).toEqual(['On pens', 'Off grip']);
    expect(rows[0]).toMatchObject({ discountType: 'fixed', items: { quantity: 2, popular: true } });
    expect(Number(rows[0].discountValue)).toBe(10);
    expect(Number(rows[0].originalPrice)).toBe(40);
    expect(rows[1].items).toEqual({ quantity: 1, off: true });

    const slug = `editor-a-${pair.a.slug}`;
    const pub = await request(app).get(`/api/public/forms/${slug}`);
    expect(pub.status).toBe(200);
    const form = pub.body.form ?? pub.body;
    expect(form.upsells.map((u: { name: string }) => u.name)).toEqual(['On pens']);
    expect('storageHost' in form).toBe(true);
  });
});
