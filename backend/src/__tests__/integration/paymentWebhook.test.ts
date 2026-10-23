/**
 * M3b-T06 (COD-32, F-404, F-405): the neutral payment webhook, online order creation, the verify API and the sweep.
 * Real database, real app; the provider is the fake one (and a signed Paystack body for the old URL). No live calls.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import crypto from 'crypto';
import request from 'supertest';

jest.mock('../../services/metaCapiService', () => require('./helpers/paymentTestKit').metaCapiMock());
jest.mock('../../services/digitalDeliveryService', () => ({
  digitalDeliveryService: {
    generateDownloadToken: (...args: unknown[]) => (global as any).__digital.generate(...args),
    sendDownloadLinks: (...args: unknown[]) => (global as any).__digital.send(...args),
  },
}));

import app from '../../server';
import logger from '../../utils/logger';
import { prismaBase } from '../../utils/prisma';
import { registerPaymentProvider, unregisterPaymentProvider, clearPaymentConfigCache } from '../../services/payments';
import { createFakeProvider, FakeProvider } from '../../services/payments/fakeProvider';
import { processCleanupStalePending, processSweepPendingCheckouts } from '../../queues/pendingCheckoutCleanupQueue';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { bearer, superAdminToken } from './helpers/superAdminToken';
import { ip, newRef, seedPending as kitSeedPending, PendingOptions } from './helpers/paymentTestKit';

jest.setTimeout(120_000);

process.env.PROVIDER_ENCRYPTION_KEY = 'cd'.repeat(32);
const realFetch = global.fetch;
let pair: TwoTenants;
let fake: FakeProvider;
let ownerToken: string;

type Side = 'a' | 'b';

const seedPending = (side: Side, reference: string, o: PendingOptions = {}) => kitSeedPending(pair, side, reference, o);

const webhook = (side: Side, reference: string | null, opts: { sig?: string; type?: string; provider?: string } = {}) =>
  request(app)
    .post(`/api/payments/webhook/${opts.provider ?? 'fake'}/${pair[side].slug}`)
    .set('X-Forwarded-For', ip())
    .set('x-fake-signature', opts.sig ?? 'valid')
    .send({ type: opts.type ?? 'payment.success', reference });

const ordersFor = (reference: string) => prismaBase.order.findMany({ where: { paymentReference: reference } });
const pendingFor = (reference: string) => prismaBase.pendingCheckout.findUnique({ where: { reference } });

beforeAll(async () => {
  pair = await createTwoTenants('payhook');
  ownerToken = await superAdminToken(pair.a.id, pair.a.slug, 'payhook-owner');
  fake = createFakeProvider('fake');
  registerPaymentProvider(fake);
  // A working Paystack connection for tenant A, to sign real Paystack bodies on the old URL.
  await prismaBase.paymentConnection.updateMany({ where: { tenantId: pair.a.id }, data: { secretKey: 'sk_test_payhook', publicKey: 'pk_test_payhook' } });
  clearPaymentConfigCache(pair.a.id);
});

beforeEach(() => {
  (global as any).__digital = {
    generate: async () => 'tok-digital',
    send: async () => undefined,
  };
});

afterEach(() => {
  global.fetch = realFetch;
});

afterAll(async () => {
  unregisterPaymentProvider('fake');
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('POST /api/payments/webhook/:provider/:tenantSlug', () => {
  it('a valid signature settles the payment and creates one confirmed, paid order', async () => {
    const ref = newRef('ok');
    await seedPending('a', ref);
    fake.setPayment(ref, { status: 'success', amount: '50', fee: '0.75', channel: 'card' });

    const res = await webhook('a', ref);
    expect(res.status).toBe(200);

    const orders = await ordersFor(ref);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', paymentProvider: 'fake', tenantId: pair.a.id });
    expect(await pendingFor(ref)).toBeNull();

    // the transaction row carries the provider fee and channel (T07 step 3)
    const txn = await prismaBase.transaction.findUniqueOrThrow({ where: { orderId: orders[0].id } });
    expect(txn).toMatchObject({ provider: 'fake', channel: 'card', currency: 'GHS', feeUnknown: false, providerReference: ref });
    expect(txn.feeAmount?.toString()).toBe('0.75');
    expect(txn.paidAt).not.toBeNull();
  });

  it('a wrong signature is 401, logged, and creates nothing', async () => {
    const ref = newRef('badsig');
    await seedPending('a', ref);
    fake.setPayment(ref, { status: 'success', amount: '50' });

    const res = await webhook('a', ref, { sig: 'forged' });
    expect(res.status).toBe(401);
    expect(logger.warn).toHaveBeenCalledWith('Invalid payment webhook signature', expect.objectContaining({ tenantId: pair.a.id, provider: 'fake' }));
    expect(await ordersFor(ref)).toHaveLength(0);
    expect(await pendingFor(ref)).not.toBeNull();
  });

  it('a signature of the wrong length is 401 too, and a missing one', async () => {
    const ref = newRef('shortsig');
    await seedPending('a', ref);
    fake.setPayment(ref, { status: 'success', amount: '50' });

    const long = await webhook('a', ref, { sig: 'valid'.repeat(40) });
    expect(long.status).toBe(401);
    const short = await webhook('a', ref, { sig: 'v' });
    expect(short.status).toBe(401);
    expect(logger.warn).toHaveBeenCalledWith('Invalid payment webhook signature', expect.objectContaining({ tenantId: pair.a.id }));
    expect(await ordersFor(ref)).toHaveLength(0);
  });

  it('the same event twice creates one order; the second answer is 200 and says duplicate', async () => {
    const ref = newRef('replay');
    await seedPending('a', ref);
    fake.setPayment(ref, { status: 'success', amount: '50' });

    const first = await webhook('a', ref);
    const second = await webhook('a', ref);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ duplicate: true });
    expect(await ordersFor(ref)).toHaveLength(1);
    expect(await prismaBase.webhookEvent.count({ where: { tenantId: pair.a.id, reference: ref } })).toBe(1);
  });

  it("a reference of another tenant is 404, logged, and tenant B's checkout stays untouched", async () => {
    const ref = newRef('cross');
    await seedPending('b', ref, { currency: 'NGN' });
    fake.setPayment(ref, { status: 'success', amount: '50', currency: 'NGN' });

    const res = await webhook('a', ref); // sent through tenant A's URL
    expect(res.status).toBe(404);
    expect(logger.warn).toHaveBeenCalledWith('Payment webhook for a reference of another tenant — ignoring', expect.objectContaining({ reference: ref, webhookTenantId: pair.a.id }));
    expect(await ordersFor(ref)).toHaveLength(0);
    expect(await pendingFor(ref)).not.toBeNull();
    // no dedup row is left behind for tenant A, so tenant B's own webhook still works
    expect(await prismaBase.webhookEvent.count({ where: { tenantId: pair.a.id, reference: ref } })).toBe(0);

    const own = await webhook('b', ref);
    expect(own.status).toBe(200);
    expect(await ordersFor(ref)).toHaveLength(1);
  });

  it('a reference unknown to every tenant is 200 and ignored', async () => {
    const res = await webhook('a', newRef('ghost'));
    expect(res.status).toBe(200);
  });

  it('other events are logged and answered 200 without settling', async () => {
    const ref = newRef('failedevt');
    await seedPending('a', ref);
    const res = await webhook('a', ref, { type: 'payment.failed' });
    expect(res.status).toBe(200);
    expect(logger.info).toHaveBeenCalledWith('Payment webhook', expect.objectContaining({ tenantId: pair.a.id, provider: 'fake', event: 'payment.failed', result: 'ignored' }));
    expect(await ordersFor(ref)).toHaveLength(0);
  });

  it('logs tenant, provider, event and result for each call', async () => {
    const ref = newRef('logline');
    await seedPending('a', ref);
    fake.setPayment(ref, { status: 'success', amount: '50' });
    await webhook('a', ref);
    expect(logger.info).toHaveBeenCalledWith('Payment webhook', expect.objectContaining({ tenantId: pair.a.id, provider: 'fake', event: 'payment.success', result: 'success' }));
  });

  it('an unknown provider is 404', async () => {
    const res = await webhook('a', newRef('noprov'), { provider: 'nosuchpay' });
    expect(res.status).toBe(404);
  });

  it('an unknown tenant slug is 404', async () => {
    const res = await request(app).post('/api/payments/webhook/fake/no-such-slug').set('x-fake-signature', 'valid').send({ type: 'payment.success', reference: 'x' });
    expect(res.status).toBe(404);
  });

  it('the old Paystack URL is an alias of the same handler: real HMAC, wrong length and valid', async () => {
    const ref = newRef('alias');
    await seedPending('a', ref, { provider: 'paystack' });
    global.fetch = (async () => ({
      ok: true, status: 200,
      json: async () => ({ status: true, data: { status: 'success', reference: ref, amount: 5000, currency: 'GHS', fees: 75, channel: 'card', paid_at: new Date().toISOString() } }),
    })) as never;

    const body = JSON.stringify({ event: 'charge.success', data: { id: 9001, reference: ref } });
    const url = `/api/paystack/webhook/${pair.a.slug}`;
    const post = (sig: string) => request(app).post(url).set('X-Forwarded-For', ip()).set('Content-Type', 'application/json').set('x-paystack-signature', sig).send(body);

    expect((await post('abc')).status).toBe(401);
    expect((await post(crypto.createHmac('sha512', 'wrong-key').update(body).digest('hex'))).status).toBe(401);
    expect(await ordersFor(ref)).toHaveLength(0);

    const good = await post(crypto.createHmac('sha512', 'sk_test_payhook').update(body).digest('hex'));
    expect(good.status).toBe(200);
    const orders = await ordersFor(ref);
    expect(orders).toHaveLength(1);
    expect(orders[0].paymentProvider).toBe('paystack');

    // and the neutral path with the same signature is the same handler (a replay now)
    const neutral = await request(app).post(`/api/payments/webhook/paystack/${pair.a.slug}`).set('X-Forwarded-For', ip()).set('Content-Type', 'application/json')
      .set('x-paystack-signature', crypto.createHmac('sha512', 'sk_test_payhook').update(body).digest('hex')).send(body);
    expect(neutral.status).toBe(200);
    expect(neutral.body).toMatchObject({ duplicate: true });
    expect(await ordersFor(ref)).toHaveLength(1);
  });

  it('charge.success for a digital form in the store currency makes a digital_delivered, paid order and sends the link', async () => {
    const ref = newRef('digital');
    const sent: unknown[][] = [];
    (global as any).__digital = { generate: async () => 'tok-1', send: async (...args: unknown[]) => { sent.push(args); } };
    await seedPending('a', ref, { orderType: 'digital' });
    fake.setPayment(ref, { status: 'success', amount: '50', fee: '0.75' });

    const res = await webhook('a', ref);
    expect(res.status).toBe(200);
    const [order] = await ordersFor(ref);
    expect(order).toMatchObject({ orderType: 'digital', status: 'digital_delivered', paymentStatus: 'paid' });
    expect(order.deliveryDate).not.toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe(order.id);
    expect(sent[0][1]).toBe('tok-1');
  });
});

describe('needs_review (payment taken, no order possible)', () => {
  const findings = (ref: string) => prismaBase.finding.findMany({ where: { tenantId: pair.a.id, type: 'payment_unmatched', subjectId: ref } });

  it('an underpayment keeps the row as needs_review and opens one payment_unmatched Finding, not two', async () => {
    const ref = newRef('under');
    await seedPending('a', ref);
    fake.setPayment(ref, { status: 'success', amount: '49.99' });

    expect((await webhook('a', ref)).status).toBe(200);
    expect(await ordersFor(ref)).toHaveLength(0);
    const row = await pendingFor(ref);
    expect(row?.status).toBe('needs_review');
    expect(row?.lastCheckedAt).not.toBeNull();
    let found = await findings(ref);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ status: 'open', subjectType: 'pending_checkout', note: `Payment received but no order was created. Reference ${ref}.` });
    expect(found[0].amount?.toString()).toBe('49.99');

    // the admin verify route runs it again: still one Finding
    const again = await request(app).get(`/api/payments/admin/verify/${ref}`).set(bearer(ownerToken));
    expect(again.status).toBe(404); // no order to return
    found = await findings(ref);
    expect(found).toHaveLength(1);
  });

  it('a currency mismatch and a missing product are needs_review too', async () => {
    const wrongCurrency = newRef('curr');
    await seedPending('a', wrongCurrency);
    fake.setPayment(wrongCurrency, { status: 'success', amount: '50', currency: 'USD' });
    await webhook('a', wrongCurrency);
    expect((await pendingFor(wrongCurrency))?.status).toBe('needs_review');
    expect(await findings(wrongCurrency)).toHaveLength(1);

    const missing = newRef('noprod');
    await seedPending('a', missing, { productId: 2_000_000_000 });
    fake.setPayment(missing, { status: 'success', amount: '50' });
    await webhook('a', missing);
    expect(await ordersFor(missing)).toHaveLength(0);
    expect((await pendingFor(missing))?.status).toBe('needs_review');
    expect(await findings(missing)).toHaveLength(1);
  });

  it('the 24 hour clean-up deletes old unpaid rows but never a needs_review row', async () => {
    const stuck = newRef('keep');
    const stale = newRef('drop');
    await seedPending('a', stuck, { status: 'needs_review', ageMinutes: 48 * 60 });
    await seedPending('a', stale, { status: 'initiated', ageMinutes: 48 * 60 });
    await processCleanupStalePending();
    expect(await pendingFor(stuck)).not.toBeNull();
    expect(await pendingFor(stale)).toBeNull();
  });
});

describe('verify API', () => {
  it('answers only the outcome: pending, then success with the order number, the form and no customer data; the old path answers the same', async () => {
    const ref = newRef('verify');
    await seedPending('a', ref);
    const formSlug = (await prismaBase.checkoutForm.findUniqueOrThrow({ where: { id: pair.a.ids.checkoutForm }, select: { slug: true } })).slug;

    for (const base of ['/api/payments/verify', '/api/paystack/verify']) {
      const res = await request(app).get(`${base}/${ref}`).set('X-Forwarded-For', ip());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'pending', orderType: 'physical', formSlug });
    }
    const row = await pendingFor(ref);
    expect(row?.status).toBe('pending');
    expect(row?.lastCheckedAt).not.toBeNull();

    // the callback page is not let ask the provider twice within 4 seconds: age the last check
    await prismaBase.pendingCheckout.update({ where: { reference: ref }, data: { lastCheckedAt: new Date(Date.now() - 10_000) } });
    fake.setPayment(ref, { status: 'success', amount: '50' });
    const done = await request(app).get(`/api/payments/verify/${ref}`).set('X-Forwarded-For', ip());
    expect(done.status).toBe(200);
    const [order] = await ordersFor(ref);
    expect(done.body).toEqual({ status: 'success', orderNumber: `#${order.id}`, orderType: 'physical', formSlug });
    // no customer data, amounts or ids anywhere in the body
    const text = JSON.stringify(done.body);
    expect(text).not.toContain(pair.a.phone);
    expect(text).not.toContain('Ama');

    // the old path, now that the order exists
    const old = await request(app).get(`/api/paystack/verify/${ref}`).set('X-Forwarded-For', ip());
    expect(old.body).toEqual(done.body);
  });

  it('two verify calls a second apart ask the provider once; a webhook still asks it', async () => {
    const ref = newRef('throttle');
    await seedPending('a', ref);
    const spy = jest.spyOn(fake, 'verify');
    try {
      const one = await request(app).get(`/api/payments/verify/${ref}`).set('X-Forwarded-For', ip());
      await new Promise((r) => setTimeout(r, 1000));
      const two = await request(app).get(`/api/payments/verify/${ref}`).set('X-Forwarded-For', ip());
      expect(one.body.status).toBe('pending');
      expect(two.body.status).toBe('pending');
      expect(spy).toHaveBeenCalledTimes(1);

      // a webhook for the same reference is not throttled
      fake.setPayment(ref, { status: 'success', amount: '50' });
      await webhook('a', ref);
      expect(spy).toHaveBeenCalledTimes(2);
      expect(await ordersFor(ref)).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('a failed payment answers failed with the form to go back to', async () => {
    const ref = newRef('failed');
    await seedPending('a', ref);
    fake.setPayment(ref, { status: 'failed', amount: '50' });
    const res = await request(app).get(`/api/payments/verify/${ref}`).set('X-Forwarded-For', ip());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
    expect(res.body.formSlug).toEqual(expect.any(String));
    expect(res.body.orderNumber).toBeUndefined();
    expect(await ordersFor(ref)).toHaveLength(0);
  });

  it('a paid digital order adds the masked email; a physical one never does', async () => {
    await prismaBase.customer.update({ where: { id: pair.a.ids.customer }, data: { email: 'ama.mensah@gmail.com' } });
    const digital = newRef('digital');
    await seedPending('a', digital, { orderType: 'digital' });
    fake.setPayment(digital, { status: 'success', amount: '50' });
    const res = await request(app).get(`/api/payments/verify/${digital}`).set('X-Forwarded-For', ip());
    expect(res.body).toMatchObject({ status: 'success', orderType: 'digital', email: 'a***@gmail.com' });
    expect(JSON.stringify(res.body)).not.toContain('ama.mensah');

    const physical = newRef('physical');
    await seedPending('a', physical);
    fake.setPayment(physical, { status: 'success', amount: '50' });
    const other = await request(app).get(`/api/payments/verify/${physical}`).set('X-Forwarded-For', ip());
    expect(other.body.email).toBeUndefined();
  });

  it('a form with a thank-you page returns it on success only, with the same details a COD order sends', async () => {
    await prismaBase.checkoutForm.update({ where: { id: pair.a.ids.checkoutForm }, data: { redirectUrl: 'https://shop.example.com/thanks' } });
    try {
      const ref = newRef('redir');
      await seedPending('a', ref);
      await prismaBase.pendingCheckout.update({ where: { reference: ref }, data: { selectedPackage: { id: 7, name: 'One' } } });
      const waiting = await request(app).get(`/api/payments/verify/${ref}`).set('X-Forwarded-For', ip());
      expect(waiting.body.redirectUrl).toBeUndefined();
      await prismaBase.pendingCheckout.update({ where: { reference: ref }, data: { lastCheckedAt: new Date(Date.now() - 10_000) } }); // past the 4 s re-check guard
      fake.setPayment(ref, { status: 'success', amount: '50' });
      const done = await request(app).get(`/api/payments/verify/${ref}`).set('X-Forwarded-For', ip());
      const [order] = await ordersFor(ref);
      const url = new URL(done.body.redirectUrl);
      expect(url.origin + url.pathname).toBe('https://shop.example.com/thanks');
      // same names and order as the checkout page builds for COD
      expect([...url.searchParams.keys()]).toEqual(['order_id', 'total', 'currency', 'reference', 'package']);
      expect(Object.fromEntries(url.searchParams)).toEqual({ order_id: String(order.id), total: '50', currency: 'GHS', reference: ref, package: '7' });
    } finally {
      await prismaBase.checkoutForm.update({ where: { id: pair.a.ids.checkoutForm }, data: { redirectUrl: null } });
    }
  });

  it('an unknown reference is not_found (200) on both paths, with nothing else', async () => {
    for (const base of ['/api/payments/verify', '/api/paystack/verify']) {
      const res = await request(app).get(`${base}/${newRef('nope')}`).set('X-Forwarded-For', ip());
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'not_found', orderType: null, formSlug: null });
    }
  });

  it("a callback never shows another tenant's order: B's reference is not found from A's admin verify", async () => {
    const ref = newRef('adminx');
    await seedPending('b', ref, { currency: 'NGN' });
    fake.setPayment(ref, { status: 'success', amount: '50', currency: 'NGN' });
    const res = await request(app).get(`/api/payments/admin/verify/${ref}`).set(bearer(ownerToken));
    expect(res.status).toBe(404);
    expect(await ordersFor(ref)).toHaveLength(0);
  });

  it('admin verify works on both paths for the signed-in tenant, and needs a login', async () => {
    const ref = newRef('admin');
    await seedPending('a', ref);
    fake.setPayment(ref, { status: 'success', amount: '50' });

    expect((await request(app).get(`/api/payments/admin/verify/${ref}`)).status).toBe(401);
    const res = await request(app).get(`/api/payments/admin/verify/${ref}`).set(bearer(ownerToken));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, paymentStatus: 'success', reference: ref });
    const old = await request(app).get(`/api/paystack/admin/verify/${ref}`).set(bearer(ownerToken));
    expect(old.status).toBe(200);
    expect(old.body.order.id).toBe(res.body.order.id);
  });
});

describe('one order per payment', () => {
  it('the webhook and the callback verify at the same time create one order', async () => {
    for (let round = 0; round < 3; round++) {
      const ref = newRef(`race${round}`);
      await seedPending('a', ref);
      fake.setPayment(ref, { status: 'success', amount: '50' });

      const results = await Promise.all([
        webhook('a', ref),
        request(app).get(`/api/payments/verify/${ref}`).set('X-Forwarded-For', ip()),
        request(app).get(`/api/paystack/verify/${ref}`).set('X-Forwarded-For', ip()),
      ]);
      for (const r of results) expect(r.status).toBe(200);
      expect(await ordersFor(ref)).toHaveLength(1);
      expect(await prismaBase.transaction.count({ where: { reference: ref } })).toBe(1);
    }
  });
});

describe('order money is stored in major units (F-405)', () => {
  it('a 249.00 order paid 30% up front: depositPaid, balanceDue, codAmount, totalAmount are all major units', async () => {
    const ref = newRef('money');
    await seedPending('a', ref, { total: '249', chargeMinor: 7470, method: 'online_deposit', codAmount: '174.30', balanceDue: '174.30' });
    fake.setPayment(ref, { status: 'success', amount: '74.70' });

    await webhook('a', ref);
    const [order] = await ordersFor(ref);
    expect(order.paymentStatus).toBe('deposited');
    expect(order.depositPaid.toString()).toBe('74.7');
    expect(order.balanceDue.toString()).toBe('174.3');
    expect(order.codAmount?.toString()).toBe('174.3');
    expect(order.totalAmount.toString()).toBe('249');
  });
});

describe('pending-checkout sweep (every 10 minutes)', () => {
  const rowsOf = (...refs: string[]) => prismaBase.pendingCheckout.findMany({ where: { reference: { in: refs } } });

  it('settles a paid checkout, closes failed and abandoned ones, marks pending ones, and leaves the rest alone', async () => {
    // a live provider must never be reached by rows left in the test database
    global.fetch = (async () => { throw new Error('no network in tests'); }) as never;

    const paid = newRef('swpaid');
    const failed = newRef('swfail');
    const abandoned = newRef('swabn');
    const waiting = newRef('swwait');
    const young = newRef('swyoung');
    const review = newRef('swrev');
    const otherTenantPaid = newRef('swb');
    await seedPending('a', paid, { ageMinutes: 11 });
    await seedPending('a', failed, { ageMinutes: 11 });
    await seedPending('a', abandoned, { ageMinutes: 30, status: 'pending' });
    await seedPending('a', waiting, { ageMinutes: 11 });
    await seedPending('a', young, { ageMinutes: 2 });
    await seedPending('a', review, { ageMinutes: 60, status: 'needs_review' });
    await seedPending('b', otherTenantPaid, { ageMinutes: 15, currency: 'NGN' });
    fake.setPayment(paid, { status: 'success', amount: '50', fee: '0.75' });
    fake.setPayment(failed, { status: 'failed', amount: '50' });
    fake.setPayment(abandoned, { status: 'abandoned', amount: '50' });
    fake.setPayment(young, { status: 'success', amount: '50' });
    fake.setPayment(review, { status: 'success', amount: '50' });
    fake.setPayment(otherTenantPaid, { status: 'success', amount: '50', currency: 'NGN' });

    await processSweepPendingCheckouts().catch(() => undefined); // leftover rows of other suites may fail; ours must not

    // success settles: order exists, row is gone
    expect(await ordersFor(paid)).toHaveLength(1);
    expect(await pendingFor(paid)).toBeNull();
    // failed and abandoned are kept with their new state
    const byRef = new Map((await rowsOf(failed, abandoned, waiting, young, review)).map((r) => [r.reference, r]));
    expect(byRef.get(failed)).toMatchObject({ status: 'failed' });
    expect(byRef.get(failed)?.lastCheckedAt).not.toBeNull();
    expect(byRef.get(abandoned)).toMatchObject({ status: 'expired' });
    expect(byRef.get(abandoned)?.lastCheckedAt).not.toBeNull();
    // a still-pending payment is marked pending
    expect(byRef.get(waiting)).toMatchObject({ status: 'pending' });
    expect(byRef.get(waiting)?.lastCheckedAt).not.toBeNull();
    // younger than 10 minutes and needs_review are not asked about
    expect(byRef.get(young)).toMatchObject({ status: 'initiated', lastCheckedAt: null });
    expect(byRef.get(review)).toMatchObject({ status: 'needs_review', lastCheckedAt: null });
    expect(await ordersFor(young)).toHaveLength(0);
    // each tenant's rows settle in that tenant
    const [orderB] = await ordersFor(otherTenantPaid);
    expect(orderB.tenantId).toBe(pair.b.id);
  });

  it('backs off: a row over an hour old is asked about once an hour; a younger row on every run', async () => {
    global.fetch = (async () => { throw new Error('no network in tests'); }) as never;
    const recentlyChecked = newRef('swbo1');
    const staleCheck = newRef('swbo2');
    const neverChecked = newRef('swbo3');
    const youngChecked = newRef('swbo4');
    await seedPending('a', recentlyChecked, { ageMinutes: 180, status: 'pending', lastCheckedMinutesAgo: 20 });
    await seedPending('a', staleCheck, { ageMinutes: 180, status: 'pending', lastCheckedMinutesAgo: 90 });
    await seedPending('a', neverChecked, { ageMinutes: 180 });
    await seedPending('a', youngChecked, { ageMinutes: 30, status: 'pending', lastCheckedMinutesAgo: 10 });

    await processSweepPendingCheckouts().catch(() => undefined);

    const rows = new Map((await prismaBase.pendingCheckout.findMany({ where: { reference: { in: [recentlyChecked, staleCheck, neverChecked, youngChecked] } } })).map((r) => [r.reference, r]));
    const checkedJustNow = (ref: string) => Date.now() - (rows.get(ref)!.lastCheckedAt as Date).getTime() < 60_000;
    expect(checkedJustNow(recentlyChecked)).toBe(false); // checked 20 minutes ago: skipped
    expect(checkedJustNow(staleCheck)).toBe(true);
    expect(checkedJustNow(neverChecked)).toBe(true);
    expect(checkedJustNow(youngChecked)).toBe(true); // under an hour old: every run
  });

  it('a run handles more rows than the pool size: 12 old checkouts are all checked', async () => {
    global.fetch = (async () => { throw new Error('no network in tests'); }) as never;
    const refs = Array.from({ length: 12 }, (_, i) => newRef(`swmany${i}`));
    for (const ref of refs) {
      await seedPending('a', ref, { ageMinutes: 25 });
      fake.setPayment(ref, { status: 'failed', amount: '50' });
    }
    await processSweepPendingCheckouts().catch(() => undefined);
    const rows = await prismaBase.pendingCheckout.findMany({ where: { reference: { in: refs } } });
    expect(rows).toHaveLength(12);
    expect(rows.every((r) => r.status === 'failed' && r.lastCheckedAt !== null)).toBe(true);
  });

  it('the sweep and a webhook for the same checkout still make one order', async () => {
    const ref = newRef('swrace');
    await seedPending('a', ref, { ageMinutes: 20 });
    fake.setPayment(ref, { status: 'success', amount: '50' });
    global.fetch = (async () => { throw new Error('no network in tests'); }) as never;

    await Promise.all([processSweepPendingCheckouts().catch(() => undefined), webhook('a', ref)]);
    expect(await ordersFor(ref)).toHaveLength(1);
  });
});

describe('two tenants', () => {
  it('each tenant webhook and Finding stay inside the tenant', async () => {
    const refA = newRef('isoa');
    const refB = newRef('isob');
    await seedPending('a', refA);
    await seedPending('b', refB, { currency: 'NGN' });
    fake.setPayment(refA, { status: 'success', amount: '10' }); // underpaid: needs_review for A
    fake.setPayment(refB, { status: 'success', amount: '10', currency: 'NGN' }); // underpaid for B

    await webhook('a', refA);
    await webhook('b', refB);
    for (const [t, ref] of [[pair.a, refA], [pair.b, refB]] as const) {
      const found = await prismaBase.finding.findMany({ where: { type: 'payment_unmatched', subjectId: ref } });
      expect(found).toHaveLength(1);
      expect(found[0].tenantId).toBe(t.id);
    }
  });
});
