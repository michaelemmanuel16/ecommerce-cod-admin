/**
 * COD-37 (M3b-T22): GET /api/public/forms/:slug reads through the embed config cache (5 minutes, cleared on save).
 * A change made straight in the database stays hidden until the cache is cleared, and a save through the API clears it.
 * Real DB, two tenants. Nothing here calls Meta or a payment provider.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { clearCheckoutFormConfigCache } from '../../services/checkoutFormService';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { bearer, superAdminToken } from './helpers/superAdminToken';

jest.setTimeout(120_000);

let pair: TwoTenants;
let owner: string;
let formId: number;

const get = (slug = pair.a.formSlug) => request(app).get(`/api/public/forms/${slug}`);

beforeAll(async () => {
  pair = await createTwoTenants('pubcache');
  owner = await superAdminToken(pair.a.id, pair.a.slug, 'cache-owner');
  formId = pair.a.ids.checkoutForm;
  await prismaBase.checkoutForm.update({ where: { id: formId }, data: { name: 'Before' } });
  await prismaBase.systemConfig.update({ where: { tenantId: pair.a.id }, data: { supportWhatsapp: '+233245550101' } });
  clearCheckoutFormConfigCache();
});

afterAll(async () => {
  clearCheckoutFormConfigCache();
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('public form page cache', () => {
  it('a second GET does not read the form again; a save through the API clears it', async () => {
    const first = await get();
    expect(first.status).toBe(200);
    expect(first.body.form.name).toBe('Before');
    expect(first.body.form.supportWhatsapp).toBe('+233245550101');
    // the page payload carries none of the server-only fields the cache also holds
    for (const key of ['tenantId', 'allowedOrigins', 'paymentProvider', 'metaCapiAccessToken', 'metaCapiTestEventCode']) {
      expect(first.body.form).not.toHaveProperty(key);
    }

    // changed behind the cache's back: the second GET still answers from the cache
    await prismaBase.checkoutForm.update({ where: { id: formId }, data: { name: 'After' } });
    expect((await get()).body.form.name).toBe('Before');

    // a save through the API clears it
    const put = await request(app).put(`/api/checkout-forms/${formId}`).set(bearer(owner)).send({ description: 'Saved through the API' });
    expect(put.status).toBe(200);
    const third = await get();
    expect(third.body.form.name).toBe('After');
    expect(third.body.form.description).toBe('Saved through the API');
  });

  it('is keyed by slug: tenant B\'s form never answers for A\'s slug, and an unknown slug is 404', async () => {
    const b = await get(pair.b.formSlug);
    expect(b.status).toBe(200);
    expect(JSON.stringify(b.body)).not.toContain(pair.a.marker);
    expect((await get('no-such-form-pubcache')).status).toBe(404);
  });

  it('a switched-off form is 404 once the cache is cleared by the save that switched it off', async () => {
    expect((await get()).status).toBe(200);
    const off = await request(app).put(`/api/checkout-forms/${formId}`).set(bearer(owner)).send({ isActive: false });
    expect(off.status).toBe(200);
    expect((await get()).status).toBe(404);
  });
});
