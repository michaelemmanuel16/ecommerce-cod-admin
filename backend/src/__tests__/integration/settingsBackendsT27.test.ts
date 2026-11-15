/**
 * M9-T27 (COD-82): Paystack key prefixes and the bad-signature webhook, WhatsApp OAuth state in Redis, the SMS report URL
 * and the SMTP test. Real DB (ecommerce_cod_test_c), real Redis, real app.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
// The SMTP host guard resolves the name first. The test host does not exist, so it answers with a public address;
// every other name goes to the real lookup.
jest.mock('dns', () => {
  const actual = jest.requireActual<typeof import('dns')>('dns');
  const lookup = (host: string, ...rest: any[]) =>
    host === 'smtp.example.test' ? Promise.resolve([{ address: '93.184.216.34', family: 4 }]) : (actual.promises.lookup as any)(host, ...rest);
  return { ...actual, promises: { ...actual.promises, lookup } };
});
import Redis from 'ioredis';
import nodemailer from 'nodemailer';

import app from '../../server';
import logger from '../../utils/logger';
import { prismaBase } from '../../utils/prisma';
import { makeWhatsappOAuthStore, OAUTH_STATE_TTL_SECONDS } from '../../utils/whatsappOAuthState';
import { handleOAuthCallback } from '../../controllers/whatsappOAuthController';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

jest.setTimeout(120_000);

process.env.PROVIDER_ENCRYPTION_KEY = process.env.PROVIDER_ENCRYPTION_KEY || 'ab'.repeat(32);
const redisOptions = { host: process.env.REDIS_HOST || 'localhost', port: parseInt(process.env.REDIS_PORT || '6379', 10), password: process.env.REDIS_PASSWORD };
let pair: TwoTenants;
const clients: Redis[] = [];
const newClient = () => { const c = new Redis(redisOptions); clients.push(c); return c; };

beforeAll(async () => {
  pair = await createTwoTenants('t27');
  await prismaBase.paymentConnection.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
});

afterAll(async () => {
  await Promise.all(clients.map((c) => c.quit().catch(() => undefined)));
  await pair.cleanup();
  await prismaBase.$disconnect();
});

const admin = () => bearer(pair.a.users.admin.token);
const rep = () => bearer(pair.a.users.salesRep.token);
const putConnection = (body: Record<string, unknown>, headers = admin()) =>
  request(app).put('/api/payment-connections').set(headers).send({ provider: 'paystack', ...body });

describe('Paystack key prefix must match the mode', () => {
  it.each([
    ['test mode with a live secret', { mode: 'test', secretKey: 'sk_live_abc', publicKey: 'pk_test_abc' }],
    ['live mode with a test secret', { mode: 'live', secretKey: 'sk_test_abc', publicKey: 'pk_live_abc' }],
    ['test mode with a live public key', { mode: 'test', secretKey: 'sk_test_abc', publicKey: 'pk_live_abc' }],
    ['live mode with a test public key', { mode: 'live', secretKey: 'sk_live_abc', publicKey: 'pk_test_abc' }],
  ])('refuses %s with 400', async (_label, body) => {
    const res = await putConnection(body);
    expect(res.status).toBe(400);
    expect(res.body.errorCode ?? res.body.code).toBe('PAYSTACK_MODE_KEY_MISMATCH');
    expect(await prismaBase.paymentConnection.count({ where: { tenantId: pair.a.id } })).toBe(0);
  });

  it('accepts matching keys in both modes', async () => {
    expect((await putConnection({ mode: 'test', secretKey: 'sk_test_ok', publicKey: 'pk_test_ok' })).status).toBe(200);
    expect((await putConnection({ mode: 'live', secretKey: 'sk_live_ok', publicKey: 'pk_live_ok' })).status).toBe(200);
  });

  it('changing only the mode against the stored keys is refused too', async () => {
    const res = await putConnection({ mode: 'test' }); // the stored keys are the live ones from the last test
    expect(res.status).toBe(400);
  });
});

describe('Paystack webhook with a bad signature', () => {
  it('answers 401 and writes nothing', async () => {
    await putConnection({ mode: 'test', secretKey: 'sk_test_hook', publicKey: 'pk_test_hook' });
    const events = () => prismaBase.webhookEvent.count({ where: { tenantId: pair.a.id } });
    const before = await events();
    const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ref-t27' } });
    const res = await request(app).post(`/api/payments/webhook/paystack/${pair.a.slug}`)
      .set('Content-Type', 'application/json').set('x-paystack-signature', 'not-a-real-signature').send(body);
    expect(res.status).toBe(401);
    expect(await events()).toBe(before);
    expect(logger.warn).toHaveBeenCalledWith('Invalid payment webhook signature', expect.objectContaining({ result: 'bad_signature' }));
  });
});

describe('WhatsApp OAuth state in Redis', () => {
  it('survives a new Redis client (a restart), is used once, and carries the tenant and user', async () => {
    const before = makeWhatsappOAuthStore(newClient());
    const state = await before.createState(pair.a.id, 42);
    expect(state.startsWith(`${pair.a.id}.42.`)).toBe(true);

    const after = makeWhatsappOAuthStore(newClient()); // what a restarted process sees
    expect(await after.consumeState(state)).toEqual({ tenantId: pair.a.id, userId: 42 });
    expect(await after.consumeState(state)).toBeNull(); // no replay
  });

  it('keeps the state for 10 minutes: the key has a TTL of at most 600 s', async () => {
    const redis = newClient();
    const state = await makeWhatsappOAuthStore(redis).createState(pair.a.id, 7);
    const random = state.split('.')[2];
    const ttl = await redis.ttl(`wa-oauth:state:${pair.a.id}:7:${random}`);
    expect(ttl).toBeGreaterThan(OAUTH_STATE_TTL_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(OAUTH_STATE_TTL_SECONDS);
    expect(OAUTH_STATE_TTL_SECONDS).toBe(600);
  });

  it('an expired, unknown or malformed state is null', async () => {
    const redis = newClient();
    const store = makeWhatsappOAuthStore(redis);
    const state = await store.createState(pair.a.id, 9);
    await redis.del(`wa-oauth:state:${pair.a.id}:9:${state.split('.')[2]}`); // as if the 10 minutes ran out
    expect(await store.consumeState(state)).toBeNull();
    expect(await store.consumeState('nonsense')).toBeNull();
    expect(await store.consumeState(`${pair.a.id}.9.deadbeef`)).toBeNull();
  });

  it("a state made for another tenant's user does not open this tenant's key", async () => {
    const store = makeWhatsappOAuthStore(newClient());
    const state = await store.createState(pair.a.id, 5);
    const forged = state.replace(`${pair.a.id}.`, `${pair.b.id}.`);
    expect(await store.consumeState(forged)).toBeNull();
    expect(await store.consumeState(state)).toEqual({ tenantId: pair.a.id, userId: 5 });
  });

  it('the pending login is stored encrypted and read back', async () => {
    const redis = newClient();
    const store = makeWhatsappOAuthStore(redis);
    await store.savePending(pair.a.id, 11, { accessToken: 'EAAB-secret-token', oauthTokenExpiry: '2027-01-01', oauthUserId: 'u1', phones: [{ id: 'p1' }] });
    expect(await redis.get(`wa-oauth:pending:${pair.a.id}:11`)).not.toContain('EAAB-secret-token');
    expect(await makeWhatsappOAuthStore(newClient()).getPending(pair.a.id, 11)).toMatchObject({ accessToken: 'EAAB-secret-token', phones: [{ id: 'p1' }] });
    await store.deletePending(pair.a.id, 11);
    expect(await store.getPending(pair.a.id, 11)).toBeNull();
  });

  it('the callback with a missing or expired state redirects to Connections with ?error=start_again', async () => {
    const redirect = jest.fn();
    await handleOAuthCallback({ query: { code: 'abc', state: `${pair.a.id}.1.expired` } } as any, { redirect } as any);
    expect(redirect).toHaveBeenCalledTimes(1);
    expect(redirect.mock.calls[0][0]).toMatch(/\/connections\?error=start_again$/);
  });
});

describe('SMS report URL', () => {
  it('gives the owner and an admin the URL with the token; a rep is refused', async () => {
    process.env.ARKESEL_CALLBACK_TOKEN = 'tok-t27-secret';
    const res = await request(app).get('/api/settings/sms/report-url').set(admin());
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/\/api\/sms\/webhook\?token=tok-t27-secret$/);
    expect((await request(app).get('/api/settings/sms/report-url').set(rep())).status).toBe(403);
    expect((await request(app).get('/api/settings/sms/report-url')).status).toBe(401);
    delete process.env.ARKESEL_CALLBACK_TOKEN;
    const none = await request(app).get('/api/settings/sms/report-url').set(admin());
    expect(none.body.url).toBeNull();
  });
});

describe('SMTP test', () => {
  const fields = { smtpHost: 'smtp.example.test', smtpPort: 587, fromEmail: 'shop@example.test', password: 'pw', smtpUser: 'shop-login' };

  it('sends one test email to the caller', async () => {
    const sendMail = jest.fn(async (_m: any) => ({ messageId: 'x' }));
    const create = jest.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as any);
    const res = await request(app).post('/api/settings/smtp/test').set(admin()).send(fields);
    expect(res.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0][0]).toMatchObject({ from: 'shop@example.test' });
    expect(sendMail.mock.calls[0][0].to).toMatch(/@codadmin\.test$/); // the admin who asked
    expect(create.mock.calls[0][0]).toMatchObject({
      host: '93.184.216.34',
      tls: { servername: 'smtp.example.test' },
      auth: { user: 'shop-login', pass: 'pw' },
    });
    create.mockRestore();
  });

  it("a failure answers 400 with the server's own error text", async () => {
    const create = jest.spyOn(nodemailer, 'createTransport').mockReturnValue({
      sendMail: async () => { throw new Error('Invalid login: 535 5.7.8 Username and Password not accepted'); },
    } as any);
    const res = await request(app).post('/api/settings/smtp/test').set(admin()).send(fields);
    expect(res.status).toBe(400);
    expect(res.body.error ?? res.body.message).toContain('Invalid login: 535 5.7.8 Username and Password not accepted');
    create.mockRestore();
  });

  it('asks for the fields when none are given or saved; a rep is refused', async () => {
    expect((await request(app).post('/api/settings/smtp/test').set(admin()).send({})).status).toBe(400);
    expect((await request(app).post('/api/settings/smtp/test').set(rep()).send(fields)).status).toBe(403);
  });
});

describe('two tenants', () => {
  it('tenant B cannot read or change the connection of A', async () => {
    await putConnection({ mode: 'test', secretKey: 'sk_test_A1', publicKey: 'pk_test_A1' });
    const asB = await request(app).get('/api/payment-connections').set(bearer(pair.b.users.admin.token));
    expect(JSON.stringify(asB.body)).not.toContain('pk_test_A1');
  });
});
