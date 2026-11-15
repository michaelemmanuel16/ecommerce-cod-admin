/** COD-86: Bulk send is open to owner, admin and manager; a sales rep (and every other role) gets 403. An empty body is 400, never 403, for the three. */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

let tenantId: string;
let tokens: Record<string, string>;

beforeAll(async () => {
  tenantId = (await createTenant('Bulk roles')).id;
  const make = async (kind: string, role: 'super_admin' | 'admin' | 'manager' | 'sales_rep' | 'accountant') => (await mkUser(tenantId, kind, role)).token;
  tokens = {
    owner: await make('owner', 'super_admin'), admin: await make('admin', 'admin'), manager: await make('manager', 'manager'),
    rep: await make('rep', 'sales_rep'), accountant: await make('acct', 'accountant'),
  };
});

afterAll(async () => {
  await deleteTenantRows([tenantId]);
  await prismaBase.$disconnect();
});

describe.each(['bulk-sms', 'bulk-whatsapp', 'bulk-email'])('POST /api/communications/%s', (route) => {
  const post = (token: string) => request(app).post(`/api/communications/${route}`).set(bearer(token)).send({});

  it('owner, admin and manager pass the role check (400 for the empty body)', async () => {
    for (const who of ['owner', 'admin', 'manager']) expect((await post(tokens[who])).status).toBe(400);
  });

  it('a sales rep and an accountant get 403', async () => {
    expect((await post(tokens.rep)).status).toBe(403);
    expect((await post(tokens.accountant)).status).toBe(403);
  });
});
