/**
 * COD-37 (M3b-T20): the two-tenant gaps of the M3b routes. Existing suites already hold:
 *   payment connections: paymentConnectionsApi (B sees nothing of A, cannot test A's), paymentConnectionModel (stamp, unique)
 *   webhook: paymentWebhook (replay, bad signature, reference of another tenant, old Paystack alias, verify of another tenant)
 *   forms: checkoutFormsApi (clone and restore of another tenant, product ownership), checkoutFormEditorApi (payment-options, upsell-stats)
 * This file adds the form routes that had no cross-tenant case (list, read, change, delete, preview, stats, test event) and
 * the resolution of a payment connection (B never resolves A's keys, A's save never changes B's). Real DB; Meta is never called.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { clearCheckoutFormConfigCache } from '../../services/checkoutFormService';
import { loadProviderConfig } from '../../services/payments/connectionConfig';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { bearer, superAdminToken } from './helpers/superAdminToken';

jest.setTimeout(120_000);

process.env.PROVIDER_ENCRYPTION_KEY = 'ef'.repeat(32);
const originalFetch = global.fetch;
let pair: TwoTenants;
let ownerA: string;
let ownerB: string;
let formA: number;
let metaCalls = 0;

beforeAll(async () => {
  pair = await createTwoTenants('m3bsweep');
  ownerA = await superAdminToken(pair.a.id, pair.a.slug, 'sweep-owner');
  ownerB = await superAdminToken(pair.b.id, pair.b.slug, 'sweep-owner');
  formA = pair.a.ids.checkoutForm;
  await prismaBase.checkoutForm.update({ where: { id: formA }, data: { metaCapiTestEventCode: 'TESTA' } });
  await prismaBase.paymentConnection.deleteMany({ where: { tenantId: { in: [pair.a.id, pair.b.id] } } });
});

afterEach(() => {
  global.fetch = originalFetch;
  clearCheckoutFormConfigCache();
});

afterAll(async () => {
  global.fetch = originalFetch;
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('forms API: tenant B against tenant A\'s form', () => {
  it('the list of B never shows A\'s form, name or slug', async () => {
    const res = await request(app).get('/api/checkout-forms?limit=100').set(bearer(ownerB));
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(pair.a.formSlug);
    expect(text).not.toContain(pair.a.marker);
    expect(text).not.toContain(pair.a.pixelId);
    expect(res.body.forms.every((f: { id: number }) => f.id !== formA)).toBe(true);
  });

  it('read, preview, stats and upsell stats of A\'s form are 404 for B, and A reads them', async () => {
    for (const path of [`/${formA}`, `/${formA}/preview-config`, `/${formA}/stats`, `/${formA}/upsell-stats`]) {
      const own = await request(app).get(`/api/checkout-forms${path}`).set(bearer(ownerA));
      expect([path, own.status]).toEqual([path, 200]);
      const cross = await request(app).get(`/api/checkout-forms${path}`).set(bearer(ownerB));
      expect([path, cross.status]).toEqual([path, 404]);
      expect(JSON.stringify(cross.body)).not.toContain(pair.a.marker);
    }
  });

  it('B cannot change or delete A\'s form; nothing of A moves', async () => {
    const before = await prismaBase.checkoutForm.findUniqueOrThrow({ where: { id: formA } });
    const put = await request(app).put(`/api/checkout-forms/${formA}`).set(bearer(ownerB)).send({ name: 'Taken over', isActive: false });
    expect(put.status).toBe(404);
    const del = await request(app).delete(`/api/checkout-forms/${formA}`).set(bearer(ownerB));
    expect(del.status).toBe(404);
    const after = await prismaBase.checkoutForm.findUniqueOrThrow({ where: { id: formA } });
    expect(after.name).toBe(before.name);
    expect(after.isActive).toBe(before.isActive);
    expect(after.archivedAt).toBeNull();
  });

  it('B cannot send a test event through A\'s form: Meta is not called', async () => {
    metaCalls = 0;
    (global as any).fetch = async () => { metaCalls += 1; return { ok: true, status: 200, text: async () => '{}' }; };
    const res = await request(app).post(`/api/checkout-forms/${formA}/test-event`).set(bearer(ownerB));
    expect(res.status).toBe(404);
    expect(metaCalls).toBe(0);
  });
});

describe('payment connection: which keys a tenant resolves', () => {
  it('B has no connection while A has one: B resolves nothing, A resolves its own secret', async () => {
    const put = await request(app).put('/api/payment-connections').set(bearer(pair.a.users.admin.token))
      .send({ provider: 'paystack', mode: 'test', publicKey: 'pk_test_SWEEPA', secretKey: 'sk_test_SWEEPA_secret' });
    expect(put.status).toBe(200);

    const forB = await runInTenant(pair.b.id, () => loadProviderConfig(pair.b.id, 'paystack'));
    expect(forB).toBeNull();
    const forA = await runInTenant(pair.a.id, () => loadProviderConfig(pair.a.id, 'paystack'));
    expect(forA).toMatchObject({ secretKey: 'sk_test_SWEEPA_secret', publicKey: 'pk_test_SWEEPA', source: 'connection' });

    const options = await request(app).get('/api/checkout-forms/payment-options').set(bearer(ownerB));
    expect(options.body.connection).toBeNull();
  });

  it('B saves its own: A\'s row and secret stay, and each tenant resolves its own', async () => {
    const aRow = await prismaBase.paymentConnection.findFirstOrThrow({ where: { tenantId: pair.a.id, provider: 'paystack' } });
    const put = await request(app).put('/api/payment-connections').set(bearer(pair.b.users.admin.token))
      .send({ id: aRow.id, tenantId: pair.a.id, provider: 'paystack', mode: 'test', publicKey: 'pk_test_SWEEPB', secretKey: 'sk_test_SWEEPB_secret' });
    expect(put.status).toBe(200);

    const aAfter = await prismaBase.paymentConnection.findUniqueOrThrow({ where: { id: aRow.id } });
    expect(aAfter.tenantId).toBe(pair.a.id);
    expect(aAfter.publicKey).toBe('pk_test_SWEEPA');
    const a = await runInTenant(pair.a.id, () => loadProviderConfig(pair.a.id, 'paystack'));
    const b = await runInTenant(pair.b.id, () => loadProviderConfig(pair.b.id, 'paystack'));
    expect(a?.secretKey).toBe('sk_test_SWEEPA_secret');
    expect(b?.secretKey).toBe('sk_test_SWEEPB_secret');
    expect(await prismaBase.paymentConnection.count({ where: { tenantId: pair.b.id } })).toBe(1);
  });

  it('B cannot read A\'s connection id through the test route, and the answer carries no key', async () => {
    const aRow = await prismaBase.paymentConnection.findFirstOrThrow({ where: { tenantId: pair.a.id, provider: 'paystack' } });
    const res = await request(app).post(`/api/payment-connections/${aRow.id}/test`).set(bearer(pair.b.users.admin.token));
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('SWEEPA');
  });
});
