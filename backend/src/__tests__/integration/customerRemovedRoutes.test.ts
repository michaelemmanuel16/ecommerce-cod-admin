/**
 * M1-T14: the dead customer routes are gone. PATCH /customers/:id/tags and
 * GET /customers/:id/analytics now return 404.
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
let tenantId: string;
let adminToken: string;

beforeAll(async () => {
  const tenant = await createTenant('Removed Routes');
  tenantId = tenant.id;
  const admin = await prismaBase.user.create({
    data: { email: `removed-routes-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Admin', lastName: 'T', role: 'admin', tenantId },
  });
  adminToken = generateAccessToken({ id: admin.id, email: admin.email, role: admin.role, tenantId });
}, 30000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('removed customer routes', () => {
  it('PATCH /api/customers/:id/tags returns 404', async () => {
    const res = await request(app).patch('/api/customers/1/tags').send({ tags: ['vip'] }).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('GET /api/customers/:id/analytics returns 404', async () => {
    const res = await request(app).get('/api/customers/1/analytics').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
