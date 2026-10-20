/**
 * M0-T18 (COD-3): public config needs a tenant or form slug and returns only that tenant's
 * business name and currency; /metrics and /health/detailed need the shared token.
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

const SUFFIX = Date.now();
const TOKEN = `metrics-token-${SUFFIX}`;
const tenantIds: string[] = [];
const T: Record<string, any> = {};
let userId: number;
let originalToken: string | undefined;

beforeAll(async () => {
  originalToken = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = TOKEN;
  for (const [side, currency] of [['A', 'GHS'], ['B', 'NGN']] as const) {
    const tenant = await createTenant(`Config ${side}`, { currency });
    tenantIds.push(tenant.id);
    await prismaBase.systemConfig.create({ data: { tenantId: tenant.id, businessName: `Biz ${side} ${SUFFIX}`, currency } });
    const product = await prismaBase.product.create({
      data: { name: `P${side}`, sku: `CFG-${side}-${SUFFIX}`, category: 'test', price: 10, stockQuantity: 5, tenantId: tenant.id },
    });
    await (prismaBase as any).checkoutForm.create({
      data: { name: `Form ${side}`, slug: `cfg-form-${side.toLowerCase()}-${SUFFIX}`, productId: product.id, fields: [], styling: {}, regions: [], tenantId: tenant.id },
    });
    T[side] = { tenantId: tenant.id, slug: tenant.slug, currency };
  }
  const user = await prismaBase.user.create({
    data: { email: `cfg-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'C', lastName: 'T', role: 'admin', tenantId: T.B.tenantId },
  });
  userId = user.id;
});

afterAll(async () => {
  if (originalToken === undefined) delete process.env.METRICS_TOKEN;
  else process.env.METRICS_TOKEN = originalToken;
  await prismaBase.user.deleteMany({ where: { id: userId } });
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});

describe('GET /api/admin/config (public)', () => {
  it('each tenant slug returns its own name and currency, and nothing else', async () => {
    for (const side of ['A', 'B'] as const) {
      const res = await request(app).get(`/api/admin/config?tenant=${T[side].slug}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ businessName: `Biz ${side} ${SUFFIX}`, currency: T[side].currency });
    }
  });

  it('a form slug resolves its tenant', async () => {
    const res = await request(app).get(`/api/admin/config?form=cfg-form-b-${SUFFIX}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ businessName: `Biz B ${SUFFIX}`, currency: 'NGN' });
  });

  it('no slug is 404, unknown tenant and unknown form are 404', async () => {
    expect((await request(app).get('/api/admin/config')).status).toBe(404);
    expect((await request(app).get('/api/admin/config?tenant=no-such-tenant')).status).toBe(404);
    expect((await request(app).get('/api/admin/config?form=no-such-form')).status).toBe(404);
  });

  it('/config/me needs a token and answers with the caller tenant', async () => {
    expect((await request(app).get('/api/admin/config/me')).status).toBe(401);
    const token = generateAccessToken({ id: userId, email: `cfg-${SUFFIX}@codadmin.test`, role: 'admin', tenantId: T.B.tenantId });
    const res = await request(app).get('/api/admin/config/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ businessName: `Biz B ${SUFFIX}`, currency: 'NGN' });
  });
});

describe('metrics and health', () => {
  it('/metrics and /health/detailed: 401 without or with a wrong token, 200 with the token', async () => {
    expect((await request(app).get('/metrics')).status).toBe(401);
    expect((await request(app).get('/metrics').set('x-metrics-token', 'wrong')).status).toBe(401);
    expect((await request(app).get('/metrics').set('x-metrics-token', TOKEN)).status).toBe(200);
    expect((await request(app).get('/health/detailed')).status).toBe(401);
    expect((await request(app).get('/health/detailed').set('x-metrics-token', 'wrong')).status).toBe(401);
    expect((await request(app).get('/health/detailed').set('x-metrics-token', TOKEN)).status).not.toBe(401);
  });

  it('with METRICS_TOKEN unset both are always 401', async () => {
    delete process.env.METRICS_TOKEN;
    expect((await request(app).get('/metrics').set('x-metrics-token', '')).status).toBe(401);
    expect((await request(app).get('/metrics').set('x-metrics-token', 'undefined')).status).toBe(401);
    process.env.METRICS_TOKEN = TOKEN;
  });

  it('/health, /live stay public', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/live')).status).toBe(200);
  });
});
