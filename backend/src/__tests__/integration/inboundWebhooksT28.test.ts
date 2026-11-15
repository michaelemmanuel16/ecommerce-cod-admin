/**
 * M9-T28 (COD-82): inbound order webhooks. Secret length, custom headers, tenant on every log row,
 * field mapping into the order service, invalid JSON, sample test, retry, and two tenants.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { bearer } from './helpers/superAdminToken';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';

let pair: TwoTenants;
let tag = 0;
const phone = () => `+23324${String(Date.now()).slice(-6)}${tag++}`.slice(0, 13);

const MAPPING = {
  customerPhone: 'phone_number',
  customerFirstName: 'customer_name',
  deliveryAddress: 'customer_address',
  deliveryState: 'region',
  quantity: 'quantity',
};

/** A config in a tenant, written straight to the table so a test can set any secret or header shape. */
async function mkConfig(tenantId: string, extra: Record<string, unknown> = {}) {
  const product = await prismaBase.product.findFirstOrThrow({ where: { tenantId } });
  return prismaBase.webhookConfig.create({
    data: {
      name: `T28 ${Date.now()}-${tag++}`, url: '', secret: 'x'.repeat(32), fieldMapping: MAPPING, headers: {},
      productId: product.id, tenantId, ...extra,
    } as any,
  });
}

const orderBody = (extra: Record<string, unknown> = {}) => ({
  order_id: `t28-${Date.now()}-${tag++}`,
  customer_name: 'Ama Mensah',
  phone_number: phone(),
  customer_address: '5 Test Road',
  region: 'Greater Accra',
  quantity: 'BUY TWO SETS - GH₵400',
  ...extra,
});

const send = (uniqueUrl: string) => request(app).post(`/api/webhooks/import/${uniqueUrl}`);

beforeAll(async () => {
  pair = await createTwoTenants('t28');
}, 60000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('1. secret length', () => {
  const body = (secret: string) => ({ name: 'Hook', url: '', secret, fieldMapping: MAPPING });

  it('create refuses a secret under 16 characters with 400', async () => {
    const res = await request(app).post('/api/webhooks').set(bearer(pair.a.users.admin.token)).send(body('a'.repeat(15)));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least 16/);
  });

  it('create accepts 16 and the API shows the secret masked', async () => {
    const secret = 'abcdefghijklmnop';
    const res = await request(app).post('/api/webhooks').set(bearer(pair.a.users.admin.token)).send(body(secret));
    expect(res.status).toBe(201);
    expect(res.body.webhook.secret).toBe('********mnop');
    expect((await prismaBase.webhookConfig.findUniqueOrThrow({ where: { id: res.body.webhook.id } })).secret).toBe(secret);
  });

  it('update refuses a short secret, and a masked secret sent back keeps the stored one', async () => {
    const cfg = await mkConfig(pair.a.id, { secret: 'k'.repeat(20) });
    const h = bearer(pair.a.users.admin.token);
    const short = await request(app).put(`/api/webhooks/${cfg.id}`).set(h).send({ secret: 'tooshort' });
    expect(short.status).toBe(400);
    const same = await request(app).put(`/api/webhooks/${cfg.id}`).set(h).send({ name: 'Renamed', secret: '********kkkk' });
    expect(same.status).toBe(200);
    const row = await prismaBase.webhookConfig.findUniqueOrThrow({ where: { id: cfg.id } });
    expect(row).toMatchObject({ name: 'Renamed', secret: 'k'.repeat(20) });
  });

  it('an existing short secret keeps working on receive', async () => {
    const cfg = await mkConfig(pair.a.id, { secret: 'old-short', requireSignature: true });
    const payload = orderBody();
    const sig = crypto.createHmac('sha256', 'old-short').update(JSON.stringify(payload)).digest('hex');
    const res = await send(cfg.uniqueUrl).set('x-webhook-signature', sig).send(payload);
    expect(res.status).toBe(200);
    expect(res.body.results.success).toBe(1);
  });
});

describe('2. custom headers', () => {
  it('401 when a header is missing or wrong, 200 when right (name case-insensitive), values masked in the API', async () => {
    const cfg = await mkConfig(pair.a.id, { headers: { 'X-Source-Key': 'header-value-12345' } });
    const missing = await send(cfg.uniqueUrl).send(orderBody());
    const wrong = await send(cfg.uniqueUrl).set('x-source-key', 'nope').send(orderBody());
    const right = await send(cfg.uniqueUrl).set('X-SOURCE-KEY', 'header-value-12345').send(orderBody());
    expect([missing.status, wrong.status, right.status]).toEqual([401, 401, 200]);
    expect(right.body.results.success).toBe(1);

    const get = await request(app).get(`/api/webhooks/${cfg.id}`).set(bearer(pair.a.users.admin.token));
    expect(get.body.webhook.headers).toEqual({ 'X-Source-Key': '********2345' });
    expect(JSON.stringify(get.body)).not.toContain('header-value-12345');
    const list = await request(app).get('/api/webhooks').set(bearer(pair.a.users.admin.token));
    expect(JSON.stringify(list.body)).not.toContain('header-value-12345');
  });

  it('update stores new headers, and a masked value sent back is kept', async () => {
    const cfg = await mkConfig(pair.a.id, { headers: { 'X-Keep': 'keep-this-value-1' } });
    const res = await request(app).put(`/api/webhooks/${cfg.id}`).set(bearer(pair.a.users.admin.token))
      .send({ headers: { 'x-keep': '********ue-1', 'X-New': 'brand-new-value' } });
    expect(res.status).toBe(200);
    const row = await prismaBase.webhookConfig.findUniqueOrThrow({ where: { id: cfg.id } });
    expect(row.headers).toEqual({ 'x-keep': 'keep-this-value-1', 'X-New': 'brand-new-value' });
  });
});

describe('3. tenant on every log row', () => {
  it('bad signature, missing header and bad JSON rows carry the tenant; an unknown URL is a 404 with no row', async () => {
    const cfg = await mkConfig(pair.b.id, { requireSignature: true, headers: { 'X-H': 'hhhhhhhhhhhh' } });
    const badSig = await send(cfg.uniqueUrl).set('x-webhook-signature', 'bad').send(orderBody());
    expect(badSig.status).toBe(401);
    const badJson = await send(cfg.uniqueUrl).set('Content-Type', 'application/json').send('{"a": ');
    expect(badJson.status).toBe(400);

    const logs = await prismaBase.webhookLog.findMany({ where: { webhookConfigId: cfg.id } });
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.tenantId === pair.b.id && !l.success)).toBe(true);

    const before = await prismaBase.webhookLog.count();
    const unknown = await send('00000000-0000-4000-8000-000000000000').send(orderBody());
    const unknownJson = await send('00000000-0000-4000-8000-000000000000').set('Content-Type', 'application/json').send('{');
    expect([unknown.status, unknownJson.status]).toEqual([404, 404]);
    expect(await prismaBase.webhookLog.count()).toBe(before);
  });
});

describe('4. field mapping goes through the order service', () => {
  it('creates the order with source, history note, customer totals and package note', async () => {
    const cfg = await mkConfig(pair.a.id);
    const payload = orderBody();
    const res = await send(cfg.uniqueUrl).send(payload);
    expect(res.status).toBe(200);
    expect(res.body.results).toMatchObject({ success: 1, failed: 0 });
    const order = await prismaBase.order.findFirstOrThrow({
      where: { externalOrderId: payload.order_id }, include: { orderHistory: true, orderItems: true, customer: true },
    });
    expect(order).toMatchObject({ source: 'webhook', tenantId: pair.a.id, notes: 'Package: BUY TWO SETS - GH₵400' });
    expect(order.orderHistory[0].notes).toBe('Order imported via webhook');
    expect(order.orderItems[0].quantity).toBe(2);
    expect(Number(order.totalAmount)).toBe(400);
    expect(order.customer.totalOrders).toBe(1); // only the order service raises it
    const log = await prismaBase.webhookLog.findFirstOrThrow({ where: { webhookConfigId: cfg.id } });
    expect(log).toMatchObject({ success: true, tenantId: pair.a.id });
  });

  it('webhook code has no raw order create', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../services/webhookService.ts'), 'utf8');
    expect(src).not.toMatch(/order\.create\(/);
  });

  it('a value that does not map goes to the notes: unknown product text and an unknown internal field', async () => {
    const cfg = await mkConfig(pair.a.id, {
      productId: null,
      fieldMapping: { ...MAPPING, productName: 'item', deliveryNote: 'variant' },
    });
    const payload = orderBody({ item: 'Blue Gadget XL', variant: 'left handed' });
    const res = await send(cfg.uniqueUrl).send(payload);
    expect(res.body.results.success).toBe(1);
    const order = await prismaBase.order.findFirstOrThrow({ where: { externalOrderId: payload.order_id } });
    expect(order.notes).toContain('Product not matched: Blue Gadget XL');
    expect(order.notes).toContain('deliveryNote: left handed');
  });

  it('a missing phone makes no order and the log says why', async () => {
    const cfg = await mkConfig(pair.a.id);
    const payload = orderBody({ phone_number: undefined });
    const res = await send(cfg.uniqueUrl).send(payload);
    expect(res.body.results).toMatchObject({ success: 0, failed: 1 });
    expect(await prismaBase.order.count({ where: { externalOrderId: payload.order_id } })).toBe(0);
    const log = await prismaBase.webhookLog.findFirstOrThrow({ where: { webhookConfigId: cfg.id } });
    expect(log.success).toBe(false);
    expect(log.errorMessage).toMatch(/phone number is required.*phone_number/);
  });
});

describe('5. invalid JSON', () => {
  it('400 with the parse error and its place, and a failed log row', async () => {
    const cfg = await mkConfig(pair.a.id);
    const raw = '{\n  "customer_name": "Ama",\n  "phone_number": \n}';
    const res = await send(cfg.uniqueUrl).set('Content-Type', 'application/json').send(raw);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/^Invalid JSON: /);
    expect(res.body.message).toMatch(/line \d+, column \d+/);
    const log = await prismaBase.webhookLog.findFirstOrThrow({ where: { webhookConfigId: cfg.id } });
    expect(log).toMatchObject({ success: false, statusCode: 400, tenantId: pair.a.id });
    expect(log.errorMessage).toBe(res.body.message);
  });
});

describe('6. sample JSON test', () => {
  it('maps the sample and creates no order, customer or log', async () => {
    const cfg = await mkConfig(pair.a.id, { fieldMapping: { ...MAPPING, extra: 'note' } });
    const count = async () => [
      await prismaBase.order.count({ where: { tenantId: pair.a.id } }),
      await prismaBase.customer.count({ where: { tenantId: pair.a.id } }),
      await prismaBase.webhookLog.count({ where: { tenantId: pair.a.id } }),
    ];
    const before = await count();
    const sample = orderBody({ note: 'gift wrap' });
    const res = await request(app).post(`/api/webhooks/${cfg.id}/test`).set(bearer(pair.a.users.admin.token)).send({ sampleData: sample });
    expect(res.status).toBe(200);
    expect(res.body.mappedData).toMatchObject({ customerPhone: sample.phone_number, customerFirstName: 'Ama Mensah' });
    expect(res.body.unmappedNotes).toEqual(['extra: gift wrap']);
    expect(res.body.missingRequired).toEqual([]);
    expect(await count()).toEqual(before);
    expect(await prismaBase.webhookLog.count({ where: { webhookConfigId: cfg.id, success: true } })).toBe(0);

    const noPhone = await request(app).post(`/api/webhooks/${cfg.id}/test`).set(bearer(pair.a.users.admin.token))
      .send({ sampleData: { customer_name: 'X' } });
    expect(noPhone.body.missingRequired).toEqual(['customerPhone']);
    const text = await request(app).post(`/api/webhooks/${cfg.id}/test`).set(bearer(pair.a.users.admin.token))
      .send({ sampleData: '{"a": ' });
    expect(text.status).toBe(400);
    expect(text.body.message).toMatch(/^Invalid JSON/);
    expect(await count()).toEqual(before);
  });
});

describe('7. retry', () => {
  it('a failed log retries into a NEW row; the old row stays; a success is refused with 409', async () => {
    const cfg = await mkConfig(pair.a.id);
    const payload = orderBody();
    const failed = await prismaBase.webhookLog.create({
      data: { tenantId: pair.a.id, webhookConfigId: cfg.id, endpoint: '/import/x', method: 'POST', headers: {}, body: payload, success: false, statusCode: 500, errorMessage: 'boom' },
    });
    const h = bearer(pair.a.users.admin.token);
    const res = await request(app).post(`/api/webhooks/${cfg.id}/logs/${failed.id}/retry`).set(h);
    expect(res.status).toBe(200);
    expect(res.body.results.success).toBe(1);

    const logs = await prismaBase.webhookLog.findMany({ where: { webhookConfigId: cfg.id }, orderBy: { id: 'asc' } });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ id: failed.id, success: false, errorMessage: 'boom' });
    expect(logs[1]).toMatchObject({ success: true, tenantId: pair.a.id });
    expect(logs[1].id).toBe(res.body.logId);

    const again = await request(app).post(`/api/webhooks/${cfg.id}/logs/${logs[1].id}/retry`).set(h);
    expect(again.status).toBe(409);
    expect(await prismaBase.webhookLog.count({ where: { webhookConfigId: cfg.id } })).toBe(2);
  });

  it('a request refused for its signature is not replayed', async () => {
    const cfg = await mkConfig(pair.a.id, { requireSignature: true });
    await send(cfg.uniqueUrl).set('x-webhook-signature', 'bad').send(orderBody());
    const log = await prismaBase.webhookLog.findFirstOrThrow({ where: { webhookConfigId: cfg.id } });
    const res = await request(app).post(`/api/webhooks/${cfg.id}/logs/${log.id}/retry`).set(bearer(pair.a.users.admin.token));
    expect(res.status).toBe(409);
  });

  it('a log of another webhook in the URL is a 404', async () => {
    const [c1, c2] = [await mkConfig(pair.a.id), await mkConfig(pair.a.id)];
    const log = await prismaBase.webhookLog.create({
      data: { tenantId: pair.a.id, webhookConfigId: c1.id, endpoint: '/x', method: 'POST', headers: {}, body: orderBody(), success: false },
    });
    const res = await request(app).post(`/api/webhooks/${c2.id}/logs/${log.id}/retry`).set(bearer(pair.a.users.admin.token));
    expect(res.status).toBe(404);
  });
});

describe('8. two tenants', () => {
  it('tenant A cannot read, edit, test or retry tenant B webhooks or logs', async () => {
    const cfgB = await mkConfig(pair.b.id, { name: 'B secret hook' });
    const logB = await prismaBase.webhookLog.create({
      data: { tenantId: pair.b.id, webhookConfigId: cfgB.id, endpoint: '/x', method: 'POST', headers: {}, body: orderBody(), success: false, statusCode: 500 },
    });
    const h = bearer(pair.a.users.admin.token);
    const results = await Promise.all([
      request(app).get(`/api/webhooks/${cfgB.id}`).set(h),
      request(app).put(`/api/webhooks/${cfgB.id}`).set(h).send({ name: 'hijack' }),
      request(app).delete(`/api/webhooks/${cfgB.id}`).set(h),
      request(app).get(`/api/webhooks/${cfgB.id}/logs`).set(h),
      request(app).get(`/api/webhooks/${cfgB.id}/stats`).set(h),
      request(app).post(`/api/webhooks/${cfgB.id}/test`).set(h).send({ sampleData: {} }),
      request(app).post(`/api/webhooks/${cfgB.id}/logs/${logB.id}/retry`).set(h),
    ]);
    expect(results.map((r) => r.status)).toEqual([404, 404, 404, 404, 404, 404, 404]);
    const list = await request(app).get('/api/webhooks').set(h);
    expect(JSON.stringify(list.body)).not.toContain('B secret hook');
    const row = await prismaBase.webhookConfig.findUniqueOrThrow({ where: { id: cfgB.id } });
    expect(row.name).toBe('B secret hook');
    expect(await prismaBase.webhookLog.count({ where: { webhookConfigId: cfgB.id } })).toBe(1);
  });
});

describe('quiz-shaped request against a config shaped like id 5', () => {
  it('creates the order as before: no signature required, empty headers, mgq- id, same mapping', async () => {
    const cfg = await mkConfig(pair.a.id, { name: 'Magic Copybook Webook Ghana', secret: 's'.repeat(32), requireSignature: false, headers: {} });
    const payload = {
      order_id: 'mgq-20261114120000-a1b2c3',
      customer_name: 'Efua Boateng',
      phone_number: phone(),
      alternative_phone_number: '',
      customer_address: '12 Quiz Lane, Madina',
      region: 'Greater Accra',
      quantity: 'BUY TWO SETS - GH₵400',
    };
    const body = JSON.stringify(payload);
    const sig = crypto.createHmac('sha256', 's'.repeat(32)).update(body).digest('hex');
    const res = await send(cfg.uniqueUrl).set('Content-Type', 'application/json').set('x-webhook-signature', sig).send(body);
    expect(res.status).toBe(200);
    expect(res.body.results).toMatchObject({ success: 1, skipped: 0, failed: 0 });

    const order = await prismaBase.order.findFirstOrThrow({ where: { externalOrderId: payload.order_id }, include: { orderItems: true } });
    expect(order).toMatchObject({ source: 'webhook', deliveryState: 'Greater Accra', deliveryAddress: '12 Quiz Lane, Madina' });
    expect(order.webhookData).toMatchObject({ order_id: payload.order_id });
    expect(Number(order.totalAmount)).toBe(400);
    expect(order.orderItems[0].quantity).toBe(2);

    // the same order id again is skipped, which the quiz relay counts as accepted
    const again = await send(cfg.uniqueUrl).set('Content-Type', 'application/json').send(body);
    expect(again.body.results).toMatchObject({ success: 0, skipped: 1 });
  });
});
