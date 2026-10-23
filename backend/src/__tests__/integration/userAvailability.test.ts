/**
 * COD-30 F2: PATCH /api/users/:id/availability is for the user themself or manager-up. Anyone else gets 403.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import '../mocks/socketInstance.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTwoTenants, TwoTenants } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';

let pair: TwoTenants;
let otherRepId: number;

const toggle = (token: string, id: number, isAvailable: boolean) =>
  request(app).patch(`/api/users/${id}/availability`).set(bearer(token)).send({ isAvailable });
const available = async (id: number) => (await prismaBase.user.findUniqueOrThrow({ where: { id } })).isAvailable;

beforeAll(async () => {
  pair = await createTwoTenants('availability');
  otherRepId = (await prismaBase.user.create({
    data: { email: `rep2-${Date.now()}@codadmin.test`, password: 'x', firstName: 'Rep', lastName: 'Two', role: 'sales_rep', tenantId: pair.a.id, isAvailable: true },
  })).id;
}, 30000);

afterAll(async () => {
  await pair.cleanup();
  await prismaBase.$disconnect();
});

describe('PATCH /api/users/:id/availability', () => {
  it('a rep changes their own availability', async () => {
    const rep = pair.a.users.salesRep;
    const res = await toggle(rep.token, rep.id, false);
    expect(res.status).toBe(200);
    expect(res.body.user.isAvailable).toBe(false);
    expect(await available(rep.id)).toBe(false);
  });

  it('a rep cannot change another rep, and a delivery agent cannot change a rep: 403', async () => {
    expect((await toggle(pair.a.users.salesRep.token, otherRepId, false)).status).toBe(403);
    expect((await toggle(pair.a.users.deliveryAgent.token, otherRepId, false)).status).toBe(403);
    expect(await available(otherRepId)).toBe(true);
  });

  it('an admin changes another user', async () => {
    const res = await toggle(pair.a.users.admin.token, otherRepId, false);
    expect(res.status).toBe(200);
    expect(await available(otherRepId)).toBe(false);
  });
});
