/** M9-T26, T29 (COD-82): Connections API, activity log, CSV template. */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { recordConnectionEvent } from '../../services/connections/connectionEventService';
import { processPurgeConnectionEvents } from '../../queues/connectionEventCleanupQueue';
import { CSV_TEMPLATE_COLUMNS, parsePartnerCsv } from '../../utils/partnerCsv';
import { encryptProviderSecrets } from '../../utils/providerCrypto';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

const SUFFIX = Date.now();
let bare: string;
let full: string;
let ownerBare: { id: number; token: string };
let adminBare: { id: number; token: string };
let managerBare: { id: number; token: string };
let repBare: { id: number; token: string };
let ownerFull: { id: number; token: string };

const saveConfig = (tenantId: string, data: Record<string, unknown>) =>
  prismaBase.systemConfig.upsert({ where: { tenantId }, create: { tenantId, ...data } as any, update: data as any });

beforeAll(async () => {
  bare = (await createTenant('Con Bare')).id;
  full = (await createTenant('Con Full')).id;
  ownerBare = await mkUser(bare, 'owner', 'super_admin');
  adminBare = await mkUser(bare, 'admin', 'admin');
  managerBare = await mkUser(bare, 'mgr', 'manager');
  repBare = await mkUser(bare, 'rep', 'sales_rep');
  ownerFull = await mkUser(full, 'owner', 'super_admin');

  // Fully connected tenant: SMS, WhatsApp, tenant SMTP email, Paystack, Meta, one form with a checkout order
  await saveConfig(full, {
    smsProvider: encryptProviderSecrets('smsProvider', { authToken: 'k', senderId: 'Shop', isEnabled: true }),
    whatsappProvider: encryptProviderSecrets('whatsappProvider', { accessToken: 'tok', phoneNumberId: '1', isEnabled: true }),
    emailProvider: encryptProviderSecrets('emailProvider', { provider: 'smtp', apiKey: 'pw', fromEmail: 'a@b.test', smtpHost: 'h', smtpPort: 587 }),
  });
  await prismaBase.paymentConnection.create({ data: { tenantId: full, provider: 'paystack', mode: 'test', publicKey: 'pk_test_x', secretKey: 'sk_test_x', isEnabled: true } });
  await prismaBase.metaAdAccount.create({ data: { tenantId: full, accountId: `act_${SUFFIX}`, name: 'Ads', currency: 'GHS', timezone: 'Africa/Accra', accessToken: 'x', status: 'connected' } });
  const product = await prismaBase.product.create({ data: { name: 'P', sku: `CON-${SUFFIX}`, price: 10, category: 'x', stockQuantity: 5, tenantId: full } as any });
  await prismaBase.checkoutForm.create({ data: { name: 'F', slug: `con-form-${SUFFIX}`, productId: product.id, fields: [], styling: {}, regions: [], tenantId: full } as any });
  const customer = await prismaBase.customer.create({ data: { firstName: 'A', lastName: 'B', phoneNumber: `+23358${String(SUFFIX).slice(-7)}`, address: 'x', state: 'x', area: 'x', tenantId: full } });
  const order = { customerId: customer.id, subtotal: 10, shippingCost: 0, totalAmount: 10, deliveryAddress: 'x', deliveryState: 'x', deliveryArea: 'x', tenantId: full, source: 'checkout_form' };
  await prismaBase.order.create({ data: { ...order, createdAt: new Date('2026-11-01T10:00:00Z') } as any });
  // A newer order made by a test action must not count
  await prismaBase.order.create({ data: { ...order, isTest: true, createdAt: new Date('2026-11-10T10:00:00Z') } as any });
});

afterAll(async () => {
  await deleteTenantRows([bare, full]);
  await prismaBase.$disconnect();
});

describe('GET /api/connections', () => {
  it('a bare tenant: every card not connected with a reason, no partner card', async () => {
    const res = await request(app).get('/api/connections').set(bearer(ownerBare.token));
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['checkout', 'csv', 'email', 'meta', 'paystack', 'sms', 'whatsapp']);
    for (const key of ['sms', 'whatsapp', 'email', 'paystack', 'meta']) {
      expect(res.body[key]).toMatchObject({ status: 'not_connected', lastEventAt: null });
      expect(res.body[key].reason).toEqual(expect.any(String));
    }
    expect(res.body.email.provider).toBeNull(); // the CodAdmin sender is not a connection, even when the app has one
    expect(res.body.checkout).toMatchObject({ status: 'not_connected', reason: 'Create a checkout form' });
    expect(JSON.stringify(res.body)).not.toMatch(/partner.*sync|syncStatus/i);
  });

  it('a fully connected tenant: connected, test orders left out of the checkout summary', async () => {
    const res = await request(app).get('/api/connections').set(bearer(ownerFull.token));
    for (const key of ['sms', 'whatsapp', 'email', 'paystack', 'meta', 'checkout']) {
      expect(res.body[key]).toMatchObject({ status: 'connected', reason: null });
    }
    expect(res.body.email.provider).toBe('smtp');
    expect(res.body.checkout).toMatchObject({ forms: 1 });
    expect(new Date(res.body.checkout.lastOrderAt).toISOString()).toBe('2026-11-01T10:00:00.000Z');
  });

  it('a recent error row turns the card to error with its message', async () => {
    await recordConnectionEvent({ tenantId: full, connection: 'sms', level: 'error', message: 'Arkesel API error 401: bad key' });
    const res = await request(app).get('/api/connections').set(bearer(ownerFull.token));
    expect(res.body.sms).toMatchObject({ status: 'error', reason: 'Arkesel API error 401: bad key' });
    expect(res.body.sms.lastEventAt).toBeTruthy();
  });

  it('needs settings:view: a sales rep gets 403; a manager and admin may read', async () => {
    expect((await request(app).get('/api/connections').set(bearer(repBare.token))).status).toBe(403);
    expect((await request(app).get('/api/connections').set(bearer(adminBare.token))).status).toBe(200);
  });

  it('DELETE /api/sms/disconnect clears the SMS connection: the card goes to not connected; manager and rep get 403 (T51)', async () => {
    const t = (await createTenant('Con Sms Off')).id;
    try {
      const owner = await mkUser(t, 'owner', 'super_admin');
      const manager = await mkUser(t, 'mgr', 'manager');
      await saveConfig(t, { smsProvider: encryptProviderSecrets('smsProvider', { authToken: 'k', senderId: 'Shop', isEnabled: true }) });
      expect((await request(app).get('/api/connections').set(bearer(owner.token))).body.sms.status).toBe('connected');

      expect((await request(app).delete('/api/sms/disconnect').set(bearer(manager.token))).status).toBe(403);
      expect((await request(app).get('/api/connections').set(bearer(owner.token))).body.sms.status).toBe('connected');

      const res = await request(app).delete('/api/sms/disconnect').set(bearer(owner.token));
      expect(res.status).toBe(200);
      expect((await prismaBase.systemConfig.findUniqueOrThrow({ where: { tenantId: t } })).smsProvider).toBeNull();
      expect((await request(app).get('/api/connections').set(bearer(owner.token))).body.sms.status).toBe('not_connected');
    } finally {
      await deleteTenantRows([t]);
    }
  });

  it('the csv card links to the template and the preview route', async () => {
    const res = await request(app).get('/api/connections').set(bearer(ownerBare.token));
    expect(res.body.csv).toMatchObject({ status: 'connected', templateUrl: '/api/connections/csv/template', previewRoute: '/api/delivery-partners/:id/csv/preview' });
  });
});

describe('activity', () => {
  it('counts per tab, filters by level, owner and admin only, two tenants apart', async () => {
    await recordConnectionEvent({ tenantId: bare, connection: 'meta', level: 'warning', message: 'Token expires soon' });
    await recordConnectionEvent({ tenantId: bare, connection: 'whatsapp', level: 'error', message: 'Refresh failed' });
    await recordConnectionEvent({ tenantId: bare, connection: 'sms', level: 'info', message: 'Key saved' });
    // The same problem inside 10 minutes is one row
    await recordConnectionEvent({ tenantId: bare, connection: 'whatsapp', level: 'error', message: 'Refresh failed' });

    const all = await request(app).get('/api/connections/activity').set(bearer(ownerBare.token));
    expect(all.status).toBe(200);
    expect(all.body.counts).toEqual({ all: 3, error: 1, warning: 1 });
    expect(all.body.items).toHaveLength(3);

    const errors = await request(app).get('/api/connections/activity?level=error').set(bearer(adminBare.token));
    expect(errors.body.items.map((i: any) => i.message)).toEqual(['Refresh failed']);
    expect((await request(app).get('/api/connections/activity?level=warning').set(bearer(ownerBare.token))).body.items[0]).toMatchObject({ connection: 'meta', level: 'warning' });

    expect((await request(app).get('/api/connections/activity').set(bearer(managerBare.token))).status).toBe(403);
    expect((await request(app).get('/api/connections/activity?level=bad').set(bearer(ownerBare.token))).status).toBe(400);
    const other = await request(app).get('/api/connections/activity').set(bearer(ownerFull.token));
    expect(other.body.items.every((i: any) => i.message !== 'Refresh failed')).toBe(true);
  });

  it('the daily job deletes rows older than 90 days and keeps newer ones', async () => {
    const old = await prismaBase.connectionEvent.create({ data: { tenantId: bare, connection: 'email', level: 'error', message: 'Old problem', createdAt: new Date(Date.now() - 91 * 24 * 3600_000) } });
    const recent = await prismaBase.connectionEvent.create({ data: { tenantId: bare, connection: 'email', level: 'error', message: 'Recent problem', createdAt: new Date(Date.now() - 89 * 24 * 3600_000) } });
    await processPurgeConnectionEvents();
    expect(await prismaBase.connectionEvent.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prismaBase.connectionEvent.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });
});

describe('GET /api/connections/csv/template', () => {
  it('downloads a CSV whose columns are the M5 partner CSV columns, and the parser accepts the header', async () => {
    const res = await request(app).get('/api/connections/csv/template').set(bearer(ownerBare.token));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    const header = res.text.trim().split(',');
    expect(header).toEqual([...CSV_TEMPLATE_COLUMNS]);
    expect(() => parsePartnerCsv(`${res.text}1042,,delivered,2026-11-01,,\n`)).not.toThrow();
    expect(parsePartnerCsv(`${res.text}1042,,delivered,2026-11-01,,\n`)[0].errors).toEqual([]);
  });
});
