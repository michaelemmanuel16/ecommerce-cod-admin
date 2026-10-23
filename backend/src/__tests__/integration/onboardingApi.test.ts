/**
 * M3-T25 (COD-24): business details and the onboarding API.
 * PUT /api/admin/settings (support WhatsApp, contact person, time zone), GET /api/onboarding/status,
 * POST /api/onboarding/setup steps 1 and 2. Two tenants prove nothing crosses over.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { generateAccessToken } from '../../utils/jwt';
import { bearer, superAdminToken } from './helpers/superAdminToken';

jest.setTimeout(120_000);

let pair: { a: { id: string; slug: string; users: { salesRep: { token: string } } }; b: { id: string; slug: string } };
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  // Bare tenants: no delivery agent yet, as for a real first-run tenant.
  const [a, b] = await Promise.all([createTenant('Onb A'), createTenant('Onb B')]);
  pair = { a: { ...a, users: { salesRep: { token: '' } } }, b };
  tokenA = await superAdminToken(pair.a.id, pair.a.slug, 'onb-owner');
  tokenB = await superAdminToken(pair.b.id, pair.b.slug, 'onb-owner');
  const rep = await prismaBase.user.create({ data: { email: 'onb-rep@codadmin.test', password: 'x', firstName: 'Rep', lastName: 'Onb', role: 'sales_rep', tenantId: a.id } });
  pair.a.users.salesRep.token = generateAccessToken({ id: rep.id, email: rep.email, role: 'sales_rep', tenantId: a.id });
}, 120_000);

afterAll(async () => {
  await prismaBase.user.deleteMany({ where: { email: { startsWith: 'onb-' } } });
  await deleteTenantRows([pair.a.id, pair.b.id]);
  await prismaBase.$disconnect();
});

const put = (token: string, body: object) => request(app).put('/api/admin/settings').set(bearer(token)).send(body);
const setup = (token: string, body: object) => request(app).post('/api/onboarding/setup').set(bearer(token)).send(body);
const status = (token: string) => request(app).get('/api/onboarding/status').set(bearer(token));

describe('PUT /api/admin/settings business details', () => {
  it('saves the business details and reads them back', async () => {
    const body = {
      businessName: 'Onb Store',
      businessEmail: 'hello@onb.test',
      businessPhone: '0245550103',
      supportWhatsapp: '+233 24 555 0103',
      taxId: 'TIN-1',
      businessAddress: '1 Ring Road, Accra',
      contactPerson: 'Ama Mensah',
      timeZone: 'Africa/Lagos',
    };
    const res = await put(tokenA, body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ...body, supportWhatsapp: '+233245550103' });
    const read = await request(app).get('/api/admin/settings').set(bearer(tokenA));
    expect(read.body).toMatchObject({ businessName: 'Onb Store', contactPerson: 'Ama Mensah', timeZone: 'Africa/Lagos' });
    // Tenant B is untouched.
    const other = await request(app).get('/api/admin/settings').set(bearer(tokenB));
    expect(other.body.contactPerson).toBeNull();
    expect(other.body.timeZone).toBe('Africa/Accra');
  });

  it('rejects a support WhatsApp that is not international with 400', async () => {
    for (const bad of ['0245550103', '+12', 'call me', '+233abc']) {
      const res = await put(tokenA, { supportWhatsapp: bad });
      expect(res.status).toBe(400);
      expect(res.body.code ?? res.body.error?.code ?? JSON.stringify(res.body)).toContain('INVALID_WHATSAPP');
    }
  });

  it('rejects an unknown time zone with 400', async () => {
    expect((await put(tokenA, { timeZone: 'Mars/Base' })).status).toBe(400);
  });

  it('has no main product or typed order value in the settings', async () => {
    const read = await request(app).get('/api/admin/settings').set(bearer(tokenA));
    expect(Object.keys(read.body).filter((k) => /mainProduct|averageOrderValue|aov/i.test(k))).toEqual([]);
  });
});

describe('onboarding status and setup', () => {
  it('status shows both steps open for a new tenant', async () => {
    const res = await status(tokenB);
    expect(res.status).toBe(200);
    expect(res.body.steps).toEqual([
      { step: 1, key: 'store', done: false },
      { step: 2, key: 'partner', done: false, skipped: false },
    ]);
  });

  it('step 1 takes the country and sets the store currency from it', async () => {
    const res = await setup(tokenA, { step: 1, country: 'Nigeria', businessName: 'Onb Store NG', businessEmail: 'ng@onb.test' });
    expect(res.status).toBe(200);
    const tenant = await prismaBase.tenant.findUnique({ where: { id: pair.a.id } });
    expect(tenant).toMatchObject({ region: 'Nigeria', currency: 'NGN', name: 'Onb Store NG' });
    const done = await status(tokenA);
    expect(done.body.steps[0].done).toBe(true);
    expect(done.body).toMatchObject({ country: 'Nigeria', currency: 'NGN' });
    // Tenant B did not move.
    expect((await prismaBase.tenant.findUnique({ where: { id: pair.b.id } }))!.currency).not.toBe('NGN');
    expect((await status(tokenB)).body.steps[0].done).toBe(false);
  });

  it('step 1 rejects an unknown country with 400', async () => {
    expect((await setup(tokenA, { step: 1, country: 'Narnia' })).status).toBe(400);
  });

  it('step 2 creates a partner user and no StockLocation', async () => {
    const stockLocationsBefore = await countStockLocations(pair.a.id);
    const res = await setup(tokenA, { step: 2, name: 'Swift Dispatch', type: '3pl', email: 'onb-swift@codadmin.test', phone: '+233245550177' });
    expect(res.status).toBe(201);
    const user = await prismaBase.user.findUnique({ where: { email: 'onb-swift@codadmin.test' } });
    expect(user).toMatchObject({ role: 'delivery_agent', tenantId: pair.a.id, firstName: 'Swift', lastName: 'Dispatch' });
    expect((user!.preferences as any).partnerType).toBe('3pl');
    expect(res.body.partner).not.toHaveProperty('password');
    expect(await countStockLocations(pair.a.id)).toBe(stockLocationsBefore);
    expect((await status(tokenA)).body.steps[1].done).toBe(true);
    expect((await status(tokenB)).body.steps[1].done).toBe(false);
  });

  it('step 2 validates the partner and can be skipped', async () => {
    expect((await setup(tokenB, { step: 2, name: 'No Email' })).status).toBe(400);
    expect((await setup(tokenB, { step: 2, name: 'X', email: 'onb-x@codadmin.test', type: 'warehouse' })).status).toBe(400);
    expect((await setup(tokenB, { step: 2, skip: true })).status).toBe(200);
    expect((await status(tokenB)).body.steps[1]).toMatchObject({ done: false, skipped: true });
  });

  it('only the owner can run setup', async () => {
    const res = await setup(pair.a.users.salesRep.token, { step: 1, country: 'Ghana' });
    expect(res.status).toBe(403);
  });
});

/** StockLocation arrives in M4; until then the table does not exist, so "none created" is a count of 0. */
async function countStockLocations(tenantId: string): Promise<number> {
  const client = prismaBase as any;
  return client.stockLocation ? client.stockLocation.count({ where: { tenantId } }) : 0;
}
