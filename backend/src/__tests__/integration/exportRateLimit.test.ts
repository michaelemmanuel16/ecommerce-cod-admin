/**
 * M3-T15 (COD-23), M3-T21 (COD-22): the export limiter stays on every export route (5 per 5 minutes, F-320, F-1057).
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows } from './helpers/twoTenants';
import { superAdminToken, bearer } from './helpers/superAdminToken';

jest.setTimeout(60_000);

let tenantId: string;
let token: string;

beforeAll(async () => {
  const tenant = await createTenant('Export Limit');
  tenantId = tenant.id;
  token = await superAdminToken(tenantId, tenant.slug, 'exportlimit');
});

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe('export rate limit', () => {
  it('the 6th export in 5 minutes is refused with 429', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await request(app).get('/api/orders/export').set(bearer(token))).status).toBe(200);
    }
    expect((await request(app).get('/api/orders/export').set(bearer(token))).status).toBe(429);
    // the customer export shares the limiter
    expect((await request(app).get('/api/customers/export').set(bearer(token))).status).toBe(429);
    // and so does the report export
    expect((await request(app).get('/api/reports/overview/export?format=csv').set(bearer(token))).status).toBe(429);
  });
});
