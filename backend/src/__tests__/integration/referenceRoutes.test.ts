/**
 * M1-T03 (COD-9): GET /api/reference/regions needs a login and returns the library regions of a country.
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
  it('requires authentication', async () => {
    const res = await request(app).get('/api/reference/regions').query({ country: 'GH' });
    expect(res.status).toBe(401);
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

  it('rejects a missing or malformed country', async () => {
    for (const q of [{}, { country: 'Ghana' }, { country: '' }]) {
      const res = await request(app).get('/api/reference/regions').query(q).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
    }
  });
});
