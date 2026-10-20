/**
 * COD-3 / M0-T08: public register is removed.
 * The old route made a tenant-less user with a role taken from the body (proved before the fix).
 */
import { jest, describe, it, expect, afterAll } from '@jest/globals';
import request from 'supertest';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';

jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({
    to: jest.fn(() => ({ emit: jest.fn() })),
    emit: jest.fn(),
  })),
  hasSocketInstance: jest.fn(() => true),
}));

const EMAIL = `leak-${Date.now()}@test.com`;

afterAll(async () => {
  await prismaBase.user.deleteMany({ where: { email: EMAIL } });
  await prismaBase.$disconnect();
});

describe('POST /api/auth/register', () => {
  it('is removed: returns 404 and creates no user', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: EMAIL, password: 'Passw0rd!x', firstName: 'Leak', lastName: 'Test',
      phoneNumber: '+2348000000000', role: 'manager',
    });
    expect(res.status).toBe(404);
    const user = await prismaBase.user.findUnique({ where: { email: EMAIL } });
    expect(user).toBeNull();
  });
});
