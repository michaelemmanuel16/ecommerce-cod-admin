/**
 * Customer list with sortBy (raw SQL branch): returns 200 (it used to 500 on a missing
 * customers.deleted_at column) and a phone search in that branch finds a number in any stored format.
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
const tail = String(SUFFIX).slice(-6);
const stored = `+233246${tail}`.slice(0, 13);
const local = `0${stored.slice(4)}`;
let tenantId: string;
let adminToken: string;
let customerId: number;

beforeAll(async () => {
  const tenant = await createTenant('Sort By');
  tenantId = tenant.id;
  const admin = await prismaBase.user.create({
    data: { email: `sort-admin-${SUFFIX}@codadmin.test`, password: 'x', firstName: 'Admin', lastName: 'T', role: 'admin', tenantId },
  });
  adminToken = generateAccessToken({ id: admin.id, email: admin.email, role: admin.role, tenantId });
  customerId = (await prismaBase.customer.create({
    data: { firstName: 'Sorted', lastName: 'Buyer', phoneNumber: stored, address: 'x', state: 'x', area: 'x', tenantId },
  })).id;
}, 30000);

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('GET /api/customers with sortBy', () => {
  const get = (query: Record<string, string>) =>
    request(app).get('/api/customers').query(query).set('Authorization', `Bearer ${adminToken}`);

  it.each(['totalOrders', 'totalSpent'])('sortBy=%s returns 200 with the customer', async (sortBy) => {
    const res = await get({ sortBy, sortOrder: 'desc' });
    expect(res.status).toBe(200);
    expect(res.body.customers.map((c: any) => c.id)).toContain(customerId);
  });

  it('a phone search in the sortBy branch finds +233... by 0...', async () => {
    const res = await get({ sortBy: 'totalOrders', search: local });
    expect(res.status).toBe(200);
    expect(res.body.customers.map((c: any) => c.id)).toEqual([customerId]);
  });

  // A partly typed local number (leading 0, first 7 digits) finds the +233... customer, with and without sortBy.
  it.each([{ sortBy: 'totalOrders' }, {}])('a partial local number finds +233... (%o)', async (extra) => {
    const res = await get({ ...extra, search: local.slice(0, 7) });
    expect(res.status).toBe(200);
    expect(res.body.customers.map((c: any) => c.id)).toContain(customerId);
  });
});
