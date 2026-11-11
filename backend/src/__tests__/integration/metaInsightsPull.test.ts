/**
 * M8-T05 (COD-71): pull the same Meta data twice into the real test DB. Same rows, same values.
 * Meta HTTP is mocked. Rows of a campaign that vanished stay.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, jest } from '@jest/globals';
import '../mocks/socketInstance.mock';
import '../mocks/logger.mock';
import { prismaBase } from '../../utils/prisma';
import { runInTenant } from '../../utils/tenantContext';
import { encryptString } from '../../utils/providerCrypto';
import { pullAccount } from '../../services/marketing/metaInsightsService';
import { createTenant } from './helpers/twoTenants';
import fixture from '../fixtures/metaInsights.json';

let tenantId: string;
let adAccountId: number;
let reply: 'full' | 'one-campaign' = 'full';

beforeAll(async () => {
  process.env.PROVIDER_ENCRYPTION_KEY = 'a'.repeat(64);
  tenantId = (await createTenant('metapull')).id;
  const acc = await prismaBase.metaAdAccount.create({
    data: {
      tenantId, accountId: '1001', name: 'MG Nigeria', currency: 'NGN', timezone: 'Africa/Accra',
      accessToken: encryptString('TOKEN_VALUE'), tokenType: 'system_user', scopes: ['ads_read'],
    },
  });
  adAccountId = acc.id;
}, 60000);

beforeEach(() => {
  (global as any).fetch = jest.fn(async (url: string) => {
    const body = url.includes('/insights')
      ? (reply === 'full' ? { data: [...fixture.page1.data, ...fixture.page2.data] } : { data: [fixture.page2.data[0]] })
      : fixture.statuses;
    return { ok: true, status: 200, json: async () => body, headers: { get: () => null } };
  });
});

afterAll(async () => {
  await prismaBase.metaSpendDay.deleteMany({ where: { tenantId } });
  await prismaBase.metaAdAccount.deleteMany({ where: { tenantId } });
  await prismaBase.tenant.delete({ where: { id: tenantId } });
  await prismaBase.$disconnect();
});

const snapshot = async () =>
  (await prismaBase.metaSpendDay.findMany({ where: { adAccountId }, orderBy: [{ campaignId: 'asc' }, { date: 'asc' }] }))
    .map(({ id, pulledAt, ...rest }) => ({ id, ...rest, spend: rest.spend.toString() }));

describe('pullAccount against the database', () => {
  it('pulling twice leaves the same rows with the same values', async () => {
    const dates = await runInTenant(tenantId, () => pullAccount(adAccountId, 3));
    expect(dates).toHaveLength(3);
    const first = await snapshot();
    expect(first).toHaveLength(3);
    expect(first[0]).toMatchObject({ campaignId: '6001', currency: 'NGN', spend: '43700.55', purchases: 7, campaignStatus: 'ACTIVE', tenantId });

    await runInTenant(tenantId, () => pullAccount(adAccountId, 3));
    expect(await snapshot()).toEqual(first);

    const acc = await prismaBase.metaAdAccount.findUniqueOrThrow({ where: { id: adAccountId } });
    expect(acc.lastPulledAt).toBeTruthy();
    expect(acc).toMatchObject({ lastPullError: null, failedPullCount: 0 });
  });

  it('a campaign that is gone from Meta keeps its rows', async () => {
    reply = 'one-campaign';
    const before = await snapshot();
    await runInTenant(tenantId, () => pullAccount(adAccountId, 3));
    expect(await snapshot()).toEqual(before);
  });
});
