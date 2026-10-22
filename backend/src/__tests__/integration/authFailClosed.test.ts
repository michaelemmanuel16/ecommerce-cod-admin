/**
 * M0-T12 (COD-4): auth flows under the fail-closed extension. Login and refresh
 * resolve the tenant from the user row; a tenant-less JWT is a platform admin or gets 403.
 */
import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import bcrypt from 'bcrypt';
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
const PASSWORD = 'Passw0rd!test';
let tenantId: string;
let tenantUser: { id: number; email: string };
let platformUser: { id: number; email: string };
let strayUser: { id: number; email: string };
let registeredTenantId: string | undefined;

const mkUser = async (label: string, extra: Record<string, unknown>) =>
  prismaBase.user.create({
    data: {
      email: `auth-${label}-${SUFFIX}@codadmin.test`,
      password: await bcrypt.hash(PASSWORD, 4),
      firstName: label,
      lastName: 'T',
      role: 'super_admin',
      ...extra,
    },
  });

// register-tenant answers 404 unless the SaaS flag is on (M3-T26).
beforeAll(async () => {
  process.env.SAAS_SIGNUP_ENABLED = 'true';
  const tenant = await createTenant('Auth');
  tenantId = tenant.id;
  tenantUser = await mkUser('tenant', { tenantId });
  platformUser = await mkUser('platform', { tenantId: null, isPlatformAdmin: true });
  strayUser = await mkUser('stray', { tenantId: null });
});

afterAll(async () => {
  delete process.env.SAAS_SIGNUP_ENABLED;
  await prismaBase.user.deleteMany({ where: { id: { in: [tenantUser.id, platformUser.id, strayUser.id] } } });
  await deleteTenantRows([tenantId, ...(registeredTenantId ? [registeredTenantId] : [])]);
  await prismaBase.$disconnect();
});

describe('auth under fail-closed', () => {
  it('login works, and the access token carries the user tenant', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: tenantUser.email, password: PASSWORD });
    expect(res.status).toBe(200);
    const orders = await request(app).get('/api/orders').set('Authorization', `Bearer ${res.body.tokens.accessToken}`);
    expect(orders.status).toBe(200);
  });

  it('refresh works with the stored refresh token', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: tenantUser.email, password: PASSWORD });
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken: login.body.tokens.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
  });

  it('wrong password is 401, unknown email is 401, forgot-password never errors', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: tenantUser.email, password: 'nope-nope' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: `ghost-${SUFFIX}@codadmin.test`, password: PASSWORD })).status).toBe(401);
    expect((await request(app).post('/api/auth/forgot-password').send({ email: `ghost-${SUFFIX}@codadmin.test` })).status).toBe(200);
  });

  it('register-tenant creates the tenant and its first user, and rejects a duplicate email', async () => {
    const body = { companyName: `Reg Co ${SUFFIX}`, adminEmail: `auth-reg-${SUFFIX}@codadmin.test`, adminPassword: PASSWORD, adminName: 'Reg Admin' };
    const res = await request(app).post('/api/auth/register-tenant').send(body);
    expect(res.status).toBe(201);
    registeredTenantId = res.body.tenant.id;
    const user = await prismaBase.user.findUnique({ where: { email: body.adminEmail } });
    expect(user!.tenantId).toBe(registeredTenantId);
    // register-tenant starts a session (M3-T23); the old column stays empty
    expect(await prismaBase.userSession.count({ where: { userId: user!.id } })).toBe(1);

    const dup = await request(app).post('/api/auth/register-tenant').send({ ...body, companyName: `Reg Co 2 ${SUFFIX}` });
    expect(dup.status).toBe(400);
  });

  it('a tenant-less JWT for a user who is not a platform admin gets 403', async () => {
    const token = generateAccessToken({ id: strayUser.id, email: strayUser.email, role: 'super_admin', tenantId: null as any });
    const res = await request(app).get('/api/orders').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('a platform admin with a tenant-less JWT can use platform routes', async () => {
    const token = generateAccessToken({ id: platformUser.id, email: platformUser.email, role: 'super_admin', tenantId: null as any });
    const res = await request(app).get('/api/platform/tenants').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
