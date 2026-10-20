/**
 * M0-T15 (COD-4): public routes and webhooks resolve the tenant before any query.
 * One test per route family: a request for tenant A never reads or writes tenant B rows,
 * and nothing crashes under the fail-closed extension.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import crypto from 'crypto';
import request from 'supertest';
import app from '../../server';
import prisma, { prismaBase } from '../../utils/prisma';
import { runInTenant, withoutTenant } from '../../utils/tenantContext';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Paystack verify must not call the network: report the payment as abandoned
jest.mock('../../services/paystackService', () => {
  const actual = jest.requireActual('../../services/paystackService') as any;
  return {
    ...actual,
    paystackService: {
      ...actual.paystackService,
      // plain function: jest resetMocks would wipe a jest.fn implementation
      verifyTransaction: async () => ({ data: { status: 'abandoned', reference: 'x', amount: 0, currency: 'GHS', fees: 0 } }),
    },
  };
});

const SUFFIX = Date.now();
const ids: { A: Record<string, any>; B: Record<string, any> } = { A: {}, B: {} };
const sides = ['A', 'B'] as const;
const phone = (side: string) => `+23355${side === 'A' ? '1' : '2'}${String(SUFFIX).slice(-6)}`;
const sign = (secret: string, raw: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

// Meta webhook secrets and phone ids, one per tenant
const waSecret = { A: `secretA-${SUFFIX}`, B: `secretB-${SUFFIX}` };
const waPhoneId = { A: `1${SUFFIX}`, B: `2${SUFFIX}` };

const waitFor = async (check: () => Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

beforeAll(async () => {
  for (const side of sides) {
    const t = await prismaBase.tenant.create({ data: { name: `Public ${side} ${SUFFIX}`, slug: `public-${side.toLowerCase()}-${SUFFIX}` } });
    const tenantId = t.id;
    const product = await prismaBase.product.create({
      data: {
        name: `Digital ${side}`, sku: `PUB-${side}-${SUFFIX}`, category: 'test', price: 10, stockQuantity: 5, tenantId,
        productType: 'digital', digitalFileUrl: `https://files.example.com/${side}.pdf`,
      },
    });
    const customer = await prismaBase.customer.create({
      data: {
        firstName: `Cust${side}`, lastName: 'T', phoneNumber: phone(side), address: '1 St', state: 'Greater Accra', area: 'Accra',
        tenantId, unsubscribeToken: `unsub-${side}-${SUFFIX}`,
      },
    });
    const order = await prismaBase.order.create({
      data: {
        customerId: customer.id, subtotal: 10, shippingCost: 0, totalAmount: 10, deliveryAddress: '1 St',
        deliveryState: 'Greater Accra', deliveryArea: 'Accra', tenantId,
        orderItems: { create: [{ productId: product.id, quantity: 1, unitPrice: 10, totalPrice: 10 }] },
      } as any,
    });
    const form = await (prismaBase as any).checkoutForm.create({
      data: { name: `Form ${side}`, slug: `pub-form-${side.toLowerCase()}-${SUFFIX}`, productId: product.id, fields: [], styling: {}, regions: [], tenantId },
    });
    await prismaBase.downloadToken.create({
      data: { orderId: order.id, token: `tok-${side}-${SUFFIX}`, expiresAt: new Date(Date.now() + 3600_000), tenantId },
    });
    await prismaBase.messageLog.create({
      data: { tenantId, channel: 'sms', messageBody: 'hi', status: 'sent', providerMessageId: `sms-${side}-${SUFFIX}` },
    });
    await prismaBase.messageLog.create({
      data: { tenantId, channel: 'whatsapp', messageBody: 'hi', status: 'sent', providerMessageId: `wamid.${side}.${SUFFIX}` },
    });
    await prismaBase.systemConfig.create({
      data: {
        tenantId,
        whatsappProvider: {
          isEnabled: true, accessToken: 'tok', phoneNumberId: waPhoneId[side], appSecret: waSecret[side], webhookVerifyToken: `verify-${side}-${SUFFIX}`,
        } as any,
      },
    });
    const hook = await prismaBase.webhookConfig.create({
      data: { name: `Hook ${side}`, url: 'x', secret: 'sec', requireSignature: true, fieldMapping: {}, tenantId, apiKey: `key-${side}-${SUFFIX}` },
    });
    await prismaBase.pendingCheckout.create({
      data: {
        tenantId, reference: `ref-${side}-${SUFFIX}`, customerId: customer.id, formId: form.id,
        paymentMethod: 'paystack_full', orderType: 'digital', currency: 'GHS', subtotal: 10, shippingCost: 0, discount: 0,
        totalAmount: 10, codAmount: 0, balanceDue: 0, paystackChargeMinor: 1000,
        formData: {}, selectedPackage: {}, orderItems: [],
      },
    });
    ids[side] = { tenantId, productId: product.id, customerId: customer.id, orderId: order.id, hookUrl: hook.uniqueUrl, hookId: hook.id };
  }
});

afterAll(async () => {
  const tenantIds = [ids.A.tenantId, ids.B.tenantId];
  await prismaBase.webhookEvent.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.pendingCheckout.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.webhookLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.webhookConfig.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.messageLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.downloadToken.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await (prismaBase as any).checkoutForm.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.orderItem.deleteMany({ where: { order: { tenantId: { in: tenantIds } } } });
  await prismaBase.order.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.customer.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.product.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.systemConfig.deleteMany({ where: { tenantId: { in: tenantIds } } });
  await prismaBase.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await prismaBase.$disconnect();
});

describe('public forms by slug', () => {
  it('returns the form of the slug tenant', async () => {
    const res = await request(app).get(`/api/public/forms/pub-form-a-${SUFFIX}`);
    expect(res.status).toBe(200);
    expect(res.body.form.name).toBe('Form A');
  });

  it('config route returns the slug tenant form and an unknown slug is 404 before any other query', async () => {
    const ok = await request(app).get(`/api/public/forms/pub-form-b-${SUFFIX}/config`);
    expect(ok.status).toBe(200);
    expect(ok.body.config.name).toBe('Form B');
    expect(ok.body.config.tenantId).toBeUndefined();

    const missing = await request(app).get('/api/public/forms/no-such-form-slug');
    expect(missing.status).toBe(404);
  });
});

describe('order tracking', () => {
  it('finds the order in its own tenant and returns the public fields', async () => {
    const res = await request(app).post('/api/public/orders/track').send({ orderId: ids.A.orderId, phoneNumber: phone('A') });
    expect(res.status).toBe(200);
    expect(res.body.order.id).toBe(ids.A.orderId);
    expect(res.body.order.items[0].name).toBe('Digital A');
    expect(Object.keys(res.body.order).sort()).toEqual(
      ['createdAt', 'customer', 'estimatedDelivery', 'history', 'id', 'items', 'partnerName', 'status', 'totalAmount']
    );
  });

  it('tenant A order id with tenant B phone is not found', async () => {
    const res = await request(app).post('/api/public/orders/track').send({ orderId: ids.A.orderId, phoneNumber: phone('B') });
    expect(res.status).toBe(404);
  });
});

describe('download by token', () => {
  it('redirects to the token tenant file and counts the download on that tenant row only', async () => {
    const res = await request(app).get(`/api/public/download/tok-A-${SUFFIX}`).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://files.example.com/A.pdf');

    const [a, b] = await Promise.all([
      prismaBase.downloadToken.findUnique({ where: { token: `tok-A-${SUFFIX}` } }),
      prismaBase.downloadToken.findUnique({ where: { token: `tok-B-${SUFFIX}` } }),
    ]);
    expect(a!.downloadCount).toBe(1);
    expect(b!.downloadCount).toBe(0);
  });

  it('unknown token is 404', async () => {
    const res = await request(app).get('/api/public/download/not-a-token').redirects(0);
    expect(res.status).toBe(404);
  });
});

describe('unsubscribe', () => {
  it('opts out only the customer that owns the token', async () => {
    const res = await request(app).post(`/api/public/unsubscribe/unsub-A-${SUFFIX}`);
    expect(res.status).toBe(200);
    const [a, b] = await Promise.all([
      prismaBase.customer.findUnique({ where: { id: ids.A.customerId } }),
      prismaBase.customer.findUnique({ where: { id: ids.B.customerId } }),
    ]);
    expect(a!.emailOptOut).toBe(true);
    expect(b!.emailOptOut).toBe(false);
  });

  it('GET confirm page works for a valid token', async () => {
    const res = await request(app).get(`/api/public/unsubscribe/unsub-B-${SUFFIX}`);
    expect(res.status).toBe(200);
  });
});

describe('SMS delivery webhook', () => {
  it('updates only the MessageLog that matches the provider id, in its own tenant', async () => {
    const res = await request(app).post('/api/sms/webhook').send({ messageId: `sms-A-${SUFFIX}`, status: 'delivered' });
    expect(res.status).toBe(200);
    const done = await waitFor(async () => {
      const row = await prismaBase.messageLog.findUnique({ where: { providerMessageId: `sms-A-${SUFFIX}` } });
      return row?.status === 'delivered';
    });
    expect(done).toBe(true);
    const b = await prismaBase.messageLog.findUnique({ where: { providerMessageId: `sms-B-${SUFFIX}` } });
    expect(b!.status).toBe('sent');
  });
});

describe('Paystack verify', () => {
  it('resolves the tenant from the reference and does not crash (payment still pending)', async () => {
    const res = await request(app).get(`/api/paystack/verify/ref-A-${SUFFIX}`);
    expect(res.status).toBe(200);
    expect(res.body.paymentStatus).toBe('pending');
  });

  it('unknown reference is 404', async () => {
    const res = await request(app).get('/api/paystack/verify/ref-does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('WhatsApp webhook', () => {
  const payload = (side: 'A' | 'B', statusIds: string[]) => JSON.stringify({
    entry: [{
      id: 'waba',
      changes: [{
        field: 'messages',
        value: { metadata: { phone_number_id: waPhoneId[side] }, statuses: statusIds.map((id) => ({ id, status: 'delivered' })) },
      }],
    }],
  });
  const post = (raw: string, secret: string) =>
    request(app).post('/api/whatsapp/webhook').set('Content-Type', 'application/json').set('x-hub-signature-256', sign(secret, raw)).send(raw);

  it('verifies with the tenant secret and updates only that tenant message logs', async () => {
    // Tenant A phone id, signed with A secret: wamid.A is updated, wamid.B (another tenant) is not
    const raw = payload('A', [`wamid.A.${SUFFIX}`, `wamid.B.${SUFFIX}`]);
    const res = await post(raw, waSecret.A);
    expect(res.status).toBe(200);
    const done = await waitFor(async () => (await prismaBase.messageLog.findUnique({ where: { providerMessageId: `wamid.A.${SUFFIX}` } }))?.status === 'delivered');
    expect(done).toBe(true);
    const b = await prismaBase.messageLog.findUnique({ where: { providerMessageId: `wamid.B.${SUFFIX}` } });
    expect(b!.status).toBe('sent');
  });

  it('rejects a payload for tenant B signed with tenant A secret', async () => {
    const res = await post(payload('B', [`wamid.B.${SUFFIX}`]), waSecret.A);
    expect(res.status).toBe(401);
  });

  it('answers 200 and processes nothing when no tenant matches the payload', async () => {
    const raw = JSON.stringify({ entry: [{ id: 'unknown', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'nope' }, statuses: [{ id: `wamid.B.${SUFFIX}`, status: 'read' }] } }] }] });
    const res = await post(raw, waSecret.B);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    const b = await prismaBase.messageLog.findUnique({ where: { providerMessageId: `wamid.B.${SUFFIX}` } });
    expect(b!.status).toBe('sent');
  });

  it('GET handshake accepts a tenant verify token and rejects a wrong one', async () => {
    const ok = await request(app).get('/api/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': `verify-B-${SUFFIX}`, 'hub.challenge': 'abc' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('abc');
    const bad = await request(app).get('/api/whatsapp/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc' });
    expect(bad.status).toBe(403);
  });
});

describe('order import webhook', () => {
  it('unique URL resolves the config tenant: bad signature is 401 and the log row belongs to that tenant', async () => {
    const res = await request(app).post(`/api/webhooks/import/${ids.A.hookUrl}`).send({ orders: [] });
    expect(res.status).toBe(401);
    const logs = await prismaBase.webhookLog.findMany({ where: { webhookConfigId: ids.A.hookId } });
    expect(logs).toHaveLength(1);
    expect(logs[0].tenantId).toBe(ids.A.tenantId);
  });

  it('unknown unique URL is 404 and API-key import without a key is 401', async () => {
    const missing = await request(app).post('/api/webhooks/import/00000000-0000-0000-0000-000000000000').send({ orders: [] });
    expect(missing.status).toBe(404);
    const noKey = await request(app).post('/api/webhooks/import').send({ orders: [] });
    expect(noKey.status).toBe(401);
  });
});

describe('Paystack webhook routes', () => {
  it('legacy POST /api/paystack/webhook (no slug) is gone: 404', async () => {
    const res = await request(app).post('/api/paystack/webhook').send({ event: 'charge.success' });
    expect(res.status).toBe(404);
  });

  it('the per-tenant slug route still resolves (unknown slug is not a 410)', async () => {
    const res = await request(app).post('/api/paystack/webhook/no-such-tenant-slug').send({ event: 'charge.success' });
    expect(res.status).not.toBe(410);
    expect(res.status).not.toBe(500);
  });
});

describe('PendingCheckout and WebhookEvent two-tenant scope', () => {
  const eventRef = (side: string) => `evt-ref-${side}-${SUFFIX}`;

  it('tenant A cannot read tenant B pending checkout or webhook event', async () => {
    for (const side of sides) {
      await prismaBase.webhookEvent.create({
        data: { tenantId: ids[side].tenantId, provider: 'paystack', eventType: 'charge.success', reference: eventRef(side), payloadHash: `h-${side}` },
      });
    }

    await runInTenant(ids.A.tenantId, async () => {
      expect(await prisma.pendingCheckout.findUnique({ where: { reference: `ref-A-${SUFFIX}` } })).not.toBeNull();
      expect(await prisma.pendingCheckout.findUnique({ where: { reference: `ref-B-${SUFFIX}` } })).toBeNull();
      const events = await prisma.webhookEvent.findMany({ where: { reference: { in: [eventRef('A'), eventRef('B')] } } });
      expect(events.map((e) => e.reference)).toEqual([eventRef('A')]);
      expect(await prisma.pendingCheckout.findMany({ where: { reference: { in: [`ref-A-${SUFFIX}`, `ref-B-${SUFFIX}`] } } })).toHaveLength(1);
    });

    await runInTenant(ids.B.tenantId, async () => {
      expect(await prisma.pendingCheckout.findUnique({ where: { reference: `ref-A-${SUFFIX}` } })).toBeNull();
      const events = await prisma.webhookEvent.findMany({ where: { reference: { in: [eventRef('A'), eventRef('B')] } } });
      expect(events.map((e) => e.reference)).toEqual([eventRef('B')]);
    });

    // Fail closed: no tenant context at all is an error, not a cross-tenant read
    await expect(prisma.pendingCheckout.findMany({})).rejects.toThrow(/TenantContextMissing/);
    await expect(prisma.webhookEvent.findMany({})).rejects.toThrow(/TenantContextMissing/);
    const all = await withoutTenant('test: unscoped read', () => prisma.webhookEvent.findMany({ where: { reference: { in: [eventRef('A'), eventRef('B')] } } }));
    expect(all).toHaveLength(2);
  });
});
