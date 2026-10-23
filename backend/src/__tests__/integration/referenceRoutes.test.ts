/**
 * M1-T03 (COD-9): GET /api/reference/regions returns the library regions of a country.
 * COD-33: it is public now; a token only supplies the store's country when none is asked for (see checkoutFormsApi.test.ts).
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { generateAccessToken } from '../../utils/jwt';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));

jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

let tenantId: string;
let token: string;

beforeAll(async () => {
  tenantId = (await createTenant('Ref Routes')).id;
  const user = await prismaBase.user.create({
    data: { email: `ref-${Date.now()}@codadmin.test`, password: 'x', firstName: 'Ref', lastName: 'T', role: 'sales_rep', tenantId },
  });

  token = generateAccessToken({ id: user.id, email: user.email, role: user.role, tenantId });
});

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('GET /api/reference/regions', () => {
  it('needs no login when a country is named', async () => {
    const res = await request(app).get('/api/reference/regions').query({ country: 'GH' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
  });

  it('returns the regions of Ghana and Nigeria', async () => {
    const gh = await request(app).get('/api/reference/regions').query({ country: 'GH' }).set('Authorization', `Bearer ${token}`);
    expect(gh.status).toBe(200);
    expect(gh.body.country).toBe('GH');
    expect(gh.body.regions).toHaveLength(16);
    expect(gh.body.regions).toContain('Greater Accra');

    const ng = await request(app).get('/api/reference/regions').query({ country: 'ng' }).set('Authorization', `Bearer ${token}`);
    expect(ng.status).toBe(200);
    expect(ng.body.country).toBe('NG');
    expect(ng.body.regions).toHaveLength(37);
  });

  it('takes a country name as well as a code', async () => {
    const res = await request(app).get('/api/reference/regions').query({ country: 'Ghana' }).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.country).toBe('GH');
  });

  it('rejects an unknown country; no country falls back to the store of the token', async () => {
    const unknown = await request(app).get('/api/reference/regions').query({ country: 'Narnia' }).set('Authorization', `Bearer ${token}`);
    expect(unknown.status).toBe(400);
    const store = await request(app).get('/api/reference/regions').set('Authorization', `Bearer ${token}`);
    expect(store.status).toBe(200);
    expect(store.body.country).toBe('GH'); // the tenant has the default currency, GHS
  });
});
