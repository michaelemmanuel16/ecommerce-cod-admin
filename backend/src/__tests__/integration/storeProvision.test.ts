/**
 * MAN-89: POST /api/stores — pay-before-materialize provisioning.
 *
 * Creating a 2nd store lands a `pending` Tenant + owner StoreMembership + a
 * per-store billing email, and kicks off a Paystack subscription with that
 * distinct email (so Paystack mints a DISTINCT customer per store). The store is
 * never marked active here — charge.success does that via the webhook.
 */
import { jest, describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import request from 'supertest';

const mockInit = jest.fn();
jest.mock('../../services/platformPaystackService', () => ({
  isPlatformBillingConfigured: jest.fn(() => true),
  platformPaystackService: {
    initializeSubscriptionTransaction: (...a: any[]) => (mockInit as any)(...a),
  },
}));
jest.mock('../../utils/socketInstance', () => ({
  setSocketInstance: jest.fn(),
  getSocketInstance: jest.fn(() => ({ to: jest.fn(() => ({ emit: jest.fn() })), emit: jest.fn() })),
  hasSocketInstance: jest.fn(() => true),
}));
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { generateAccessToken } from '../../utils/jwt';

const SUFFIX = Date.now();
const OWNER_EMAIL = `prov-owner-${SUFFIX}@shop.com`;

let ownerId: number;
let existingStoreId: string;
let ownerToken: string;
const createdTenantIds: string[] = [];

// resetMocks:true wipes implementations before every test, so (re)set the
// resolved value here rather than once in beforeAll.
beforeEach(() => {
  mockInit.mockResolvedValue({
    authorization_url: 'https://checkout.paystack.com/xyz',
    access_code: 'AC_test',
    reference: 'ref_test_123',
  });
});

beforeAll(async () => {
  await prismaBase.plan.upsert({
    where: { name: 'growth' },
    update: { paystackPlanCode: 'PLN_growth_test', priceNGN: 15000, isActive: true },
    create: {
      name: 'growth', displayName: 'Growth', priceGHS: 200, priceNGN: 15000,
      paystackPlanCode: 'PLN_growth_test', features: {}, isActive: true,
    },
  });

  const store = await prismaBase.tenant.create({
    data: { name: `Existing ${SUFFIX}`, slug: `existing-${SUFFIX}`, subscriptionStatus: 'active' },
  });
  existingStoreId = store.id;
  createdTenantIds.push(existingStoreId);

  const owner = await prismaBase.user.create({
    data: { email: OWNER_EMAIL, password: 'x', role: 'super_admin', firstName: 'Prov', lastName: 'Owner', tenantId: existingStoreId },
  });
  ownerId = owner.id;
  await prismaBase.tenant.update({ where: { id: existingStoreId }, data: { ownerUserId: ownerId } });
  await prismaBase.storeMembership.create({
    data: { userId: ownerId, tenantId: existingStoreId, role: 'super_admin', isDefault: true },
  });

  ownerToken = generateAccessToken({ id: ownerId, email: OWNER_EMAIL, role: 'super_admin', tenantId: existingStoreId });
});

afterAll(async () => {
  await prismaBase.storeMembership.deleteMany({ where: { userId: ownerId } });
  await prismaBase.tenant.updateMany({ where: { id: { in: createdTenantIds } }, data: { ownerUserId: null } });
  await prismaBase.user.deleteMany({ where: { id: ownerId } });
  await prismaBase.tenant.deleteMany({ where: { id: { in: createdTenantIds } } });
  await prismaBase.$disconnect();
});

describe('POST /api/stores', () => {
  it('provisions a pending store + membership + per-store billing email and starts a subscription', async () => {
    mockInit.mockClear();
    const res = await request(app)
      .post('/api/stores')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Second Shop', planName: 'growth' });

    expect(res.status).toBe(201);
    expect(res.body.authorizationUrl).toBe('https://checkout.paystack.com/xyz');
    const newTenantId = res.body.tenantId as string;
    expect(newTenantId).toBeDefined();
    createdTenantIds.push(newTenantId);

    const tenant = await prismaBase.tenant.findUnique({ where: { id: newTenantId } });
    expect(tenant?.subscriptionStatus).toBe('pending');
    expect(tenant?.ownerUserId).toBe(ownerId);
    const expectedEmail = `prov-owner-${SUFFIX}+store-${tenant!.slug}@shop.com`;
    expect(tenant?.billingEmail).toBe(expectedEmail);
    expect(res.body.billingEmail).toBe(expectedEmail);

    const membership = await prismaBase.storeMembership.findFirst({ where: { userId: ownerId, tenantId: newTenantId } });
    expect(membership).not.toBeNull();
    expect(membership?.isDefault).toBe(false);

    // Distinct customer proof: the per-store email (not the owner's plain email)
    // is what Paystack receives, plus metadata routing the correct tenant.
    expect(mockInit).toHaveBeenCalledTimes(1);
    const [email, planCode, amountMinor, metadata] = mockInit.mock.calls[0] as any[];
    expect(email).toBe(expectedEmail);
    expect(email).not.toBe(OWNER_EMAIL);
    expect(planCode).toBe('PLN_growth_test');
    expect(amountMinor).toBe(1500000); // 15000 NGN * 100, server-computed
    expect(metadata).toMatchObject({ tenantId: newTenantId, kind: 'saas_subscription' });
  });

  it('issues a DISTINCT billing email (distinct customer) for a second new store', async () => {
    const res = await request(app)
      .post('/api/stores')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Third Shop', planName: 'growth' });
    expect(res.status).toBe(201);
    createdTenantIds.push(res.body.tenantId);

    const second = await prismaBase.tenant.findUnique({ where: { id: createdTenantIds[1] }, select: { billingEmail: true } });
    const third = await prismaBase.tenant.findUnique({ where: { id: res.body.tenantId }, select: { billingEmail: true } });
    expect(third?.billingEmail).not.toBe(second?.billingEmail);
  });

  it('rejects a non-self-serve plan (400) and does not create a store or call Paystack', async () => {
    mockInit.mockClear();
    const before = await prismaBase.tenant.count({ where: { ownerUserId: ownerId } });
    const res = await request(app)
      .post('/api/stores')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Nope Shop', planName: 'enterprise' });
    expect(res.status).toBe(400);
    expect(mockInit).not.toHaveBeenCalled();
    const after = await prismaBase.tenant.count({ where: { ownerUserId: ownerId } });
    expect(after).toBe(before);
  });

  it('rejects a missing name (400)', async () => {
    const res = await request(app)
      .post('/api/stores')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ planName: 'growth' });
    expect(res.status).toBe(400);
  });
});
