/**
 * M8-T09 (COD-73): campaign to product mapping. Rules and picks, campaign list and unmapped list with spend,
 * duplicate prefix 409, two-tenant isolation, call rep 403, a marketing:view-only user cannot write.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import '../mocks/logger.mock';
import app from '../../server';
import { prismaBase } from '../../utils/prisma';
import { createTenant, deleteTenantRows, mkUser } from './helpers/twoTenants';
import { bearer } from './helpers/superAdminToken';
import { seedTenantDefaults } from '../../services/tenantDefaultsService';

const tenantIds: string[] = [];
let tA: string;
let tB: string;
let ownerA: { id: number; token: string };
let ownerB: { id: number; token: string };
let viewerA: { id: number; token: string };
let repA: { id: number; token: string };
let mgA: number; // Magic Groove, active
let kitA: number; // second product
let oldA: number; // archived product
let productB: number;
let accountA: number;
let accountB: number;

const RANGE = '?from=2026-11-01&to=2026-11-07';
const mkProduct = (tenantId: string, name: string, isActive = true) =>
  prismaBase.product.create({ data: { name, sku: `${name.replace(/\s+/g, '-')}-${Date.now()}`, price: 100, stockQuantity: 1, category: 'Test', isActive, tenantId } }).then((p) => p.id);
const mkAccount = (tenantId: string, accountId: string, currency = 'USD') =>
  prismaBase.metaAdAccount.create({ data: { accountId, name: accountId, currency, timezone: 'Africa/Accra', accessToken: 'enc:v1:x', tenantId } }).then((a) => a.id);
const spend = (tenantId: string, adAccountId: number, campaignId: string, campaignName: string, date: string, amount: string) =>
  prismaBase.metaSpendDay.create({
    data: { tenantId, adAccountId, campaignId, campaignName, date: new Date(`${date}T00:00:00.000Z`), currency: 'USD', spend: amount, pulledAt: new Date() },
  });

beforeAll(async () => {
  tA = (await createTenant('Mapping A')).id;
  tB = (await createTenant('Mapping B')).id;
  tenantIds.push(tA, tB);
  await Promise.all([seedTenantDefaults(tA), seedTenantDefaults(tB)]);
  [ownerA, viewerA, repA, ownerB] = await Promise.all([
    mkUser(tA, 'owner', 'super_admin'),
    mkUser(tA, 'viewer', 'manager'),
    mkUser(tA, 'rep', 'sales_rep'),
    mkUser(tB, 'owner', 'super_admin'),
  ]);
  [mgA, kitA, oldA, productB] = await Promise.all([
    mkProduct(tA, 'Magic Groove'),
    mkProduct(tA, 'Kit'),
    mkProduct(tA, 'Pile Combo', false),
    mkProduct(tB, 'Other Tenant Product'),
  ]);
  [accountA, accountB] = await Promise.all([mkAccount(tA, 'act_1'), mkAccount(tB, 'act_2')]);
  await Promise.all([
    spend(tA, accountA, 'c-mg', 'MG_ManualCBO | 16032026', '2026-11-02', '10.5000'),
    spend(tA, accountA, 'c-mg', 'MG_ManualCBO | 16032026', '2026-11-03', '4.2500'),
    spend(tA, accountA, 'c-other', 'Retargeting', '2026-11-02', '7.0000'),
    spend(tA, accountA, 'c-old', 'PC_Combo', '2026-11-04', '3.0000'),
    spend(tA, accountA, 'c-out', 'Out of range', '2026-10-20', '99.0000'),
    spend(tB, accountB, 'c-b', 'MG_FromB', '2026-11-02', '500.0000'),
  ]);
});

afterAll(async () => {
  const t = { tenantId: { in: tenantIds } };
  await prismaBase.metaCampaignMapping.deleteMany({ where: t });
  await prismaBase.metaSpendDay.deleteMany({ where: t });
  await prismaBase.metaAdAccount.deleteMany({ where: t });
  await deleteTenantRows(tenantIds);
  await prismaBase.$disconnect();
});

const addRule = (prefix: string, productId: number, who = ownerA) =>
  request(app).post('/api/marketing/mappings/rules').set(bearer(who.token)).send({ prefix, productId });
const campaigns = (who = ownerA) => request(app).get(`/api/marketing/campaigns${RANGE}`).set(bearer(who.token));

describe('rules', () => {
  let ruleId: number;

  it('creates a rule, trims the prefix, and lists it with the product name', async () => {
    const res = await addRule('  MG_  ', mgA);
    expect(res.status).toBe(201);
    expect(res.body.prefix).toBe('MG_');
    ruleId = res.body.id;
    const list = await request(app).get('/api/marketing/mappings').set(bearer(ownerA.token));
    expect(list.status).toBe(200);
    expect(list.body.rules).toEqual([expect.objectContaining({ id: ruleId, prefix: 'MG_', product: { id: mgA, name: 'Magic Groove', archived: false } })]);
    expect(list.body.picks).toEqual([]);
  });

  it('rejects a duplicate prefix with 409 (also in another case)', async () => {
    for (const p of ['MG_', 'mg_']) {
      const res = await addRule(p, kitA);
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('This prefix is already mapped.');
    }
  });

  it('rejects an empty or too long prefix, and a product of another tenant with 404', async () => {
    expect((await addRule('   ', mgA)).status).toBe(400);
    expect((await addRule('x'.repeat(41), mgA)).status).toBe(400);
    expect((await addRule('ZZ_', productB)).status).toBe(404);
    expect((await addRule('ZZ_', 999999999)).status).toBe(404);
  });

  it('lists campaigns in the range with total spend and the resolved product', async () => {
    const res = await campaigns();
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.campaigns.map((c: any) => [c.campaignId, c]));
    expect(Object.keys(byId).sort()).toEqual(['c-mg', 'c-old', 'c-other']); // c-out is outside the range, c-b is tenant B
    expect(byId['c-mg']).toMatchObject({ spend: '14.7500', currency: 'USD', mapped: true, product: { productId: mgA, via: 'prefix', archived: false } });
    expect(byId['c-other']).toMatchObject({ spend: '7.0000', mapped: false, product: null });
    expect(res.body.campaigns[0].campaignId).toBe('c-mg'); // highest spend first
  });

  it('a pick beats the rule; a null product removes the pick', async () => {
    const put = await request(app).put('/api/marketing/mappings/campaigns').set(bearer(ownerA.token)).send({ adAccountId: accountA, campaignId: 'c-mg', productId: kitA });
    expect(put.status).toBe(200);
    let c = (await campaigns()).body.campaigns.find((x: any) => x.campaignId === 'c-mg');
    expect(c.product).toMatchObject({ productId: kitA, via: 'campaign' });

    // upsert: a second pick for the same campaign replaces the first, never adds a row
    await request(app).put('/api/marketing/mappings/campaigns').set(bearer(ownerA.token)).send({ adAccountId: accountA, campaignId: 'c-mg', productId: mgA });
    expect(await prismaBase.metaCampaignMapping.count({ where: { tenantId: tA, kind: 'campaign' } })).toBe(1);

    const del = await request(app).put('/api/marketing/mappings/campaigns').set(bearer(ownerA.token)).send({ adAccountId: accountA, campaignId: 'c-mg', productId: null });
    expect(del.status).toBe(200);
    c = (await campaigns()).body.campaigns.find((x: any) => x.campaignId === 'c-mg');
    expect(c.product).toMatchObject({ productId: mgA, via: 'prefix' });
  });

  it('a pick needs an ad account and a product of this tenant', async () => {
    const send = (b: object) => request(app).put('/api/marketing/mappings/campaigns').set(bearer(ownerA.token)).send(b);
    expect((await send({ adAccountId: accountB, campaignId: 'c-b', productId: mgA })).status).toBe(404);
    expect((await send({ adAccountId: accountA, campaignId: 'c-mg', productId: productB })).status).toBe(404);
    expect((await send({ adAccountId: accountA, campaignId: 'c-mg' })).status).toBe(400);
  });

  it('an archived product still maps and is flagged', async () => {
    // A product archived after its rule was made (new rules cannot target an archived product).
    await prismaBase.metaCampaignMapping.create({ data: { kind: 'prefix', prefix: 'PC_', productId: oldA, tenantId: tA } });
    const c = (await campaigns()).body.campaigns.find((x: any) => x.campaignId === 'c-old');
    expect(c.product).toMatchObject({ productId: oldA, productName: 'Pile Combo', archived: true });
    const list = await request(app).get('/api/marketing/mappings').set(bearer(ownerA.token));
    expect(list.body.rules.find((r: any) => r.prefix === 'PC_').product.archived).toBe(true);
  });

  it('lists the unmapped campaigns with their spend, then deletes the rule', async () => {
    let un = await request(app).get(`/api/marketing/campaigns/unmapped${RANGE}`).set(bearer(ownerA.token));
    expect(un.status).toBe(200);
    expect(un.body.campaigns.map((c: any) => c.campaignId)).toEqual(['c-other']);
    expect(un.body.spendByCurrency).toEqual({ USD: '7.0000' });

    const del = await request(app).delete(`/api/marketing/mappings/rules/${ruleId}`).set(bearer(ownerA.token));
    expect(del.status).toBe(204);
    un = await request(app).get(`/api/marketing/campaigns/unmapped${RANGE}`).set(bearer(ownerA.token));
    expect(un.body.campaigns.map((c: any) => c.campaignId).sort()).toEqual(['c-mg', 'c-other']);
    expect(un.body.spendByCurrency).toEqual({ USD: '21.7500' });
    expect((await request(app).delete(`/api/marketing/mappings/rules/${ruleId}`).set(bearer(ownerA.token))).status).toBe(404);
  });

  it('needs a valid date range', async () => {
    const get = (q: string) => request(app).get(`/api/marketing/campaigns${q}`).set(bearer(ownerA.token));
    expect((await get('')).status).toBe(400);
    expect((await get('?from=2026-11-09&to=2026-11-01')).status).toBe(400);
    expect((await get('?from=nope&to=2026-11-01')).status).toBe(400);
  });
});

describe('isolation and permissions', () => {
  it('tenant B sees none of tenant A mappings or spend, and A rules do not reach B campaigns', async () => {
    const list = await request(app).get('/api/marketing/mappings').set(bearer(ownerB.token));
    expect(list.body).toEqual({ rules: [], picks: [] });
    const res = await campaigns(ownerB);
    expect(res.body.campaigns).toHaveLength(1);
    expect(res.body.campaigns[0]).toMatchObject({ campaignId: 'c-b', spend: '500.0000', mapped: false });
    expect(JSON.stringify(res.body)).not.toContain('Retargeting');
    // B cannot delete A's rule
    const ruleA = await prismaBase.metaCampaignMapping.findFirstOrThrow({ where: { tenantId: tA, kind: 'prefix' } });
    expect((await request(app).delete(`/api/marketing/mappings/rules/${ruleA.id}`).set(bearer(ownerB.token))).status).toBe(404);
    expect(await prismaBase.metaCampaignMapping.count({ where: { id: ruleA.id } })).toBe(1);
  });

  it('a call rep gets 403 on every route', async () => {
    const h = bearer(repA.token);
    expect((await request(app).get('/api/marketing/mappings').set(h)).status).toBe(403);
    expect((await request(app).get(`/api/marketing/campaigns${RANGE}`).set(h)).status).toBe(403);
    expect((await request(app).get(`/api/marketing/campaigns/unmapped${RANGE}`).set(h)).status).toBe(403);
    expect((await addRule('RP_', mgA, repA)).status).toBe(403);
  });

  it('a marketing:view-only user can read but not write', async () => {
    const h = bearer(viewerA.token);
    expect((await request(app).get('/api/marketing/mappings').set(h)).status).toBe(200);
    expect((await request(app).get(`/api/marketing/campaigns${RANGE}`).set(h)).status).toBe(200);
    expect((await addRule('VW_', mgA, viewerA)).status).toBe(403);
    expect((await request(app).put('/api/marketing/mappings/campaigns').set(h).send({ adAccountId: accountA, campaignId: 'c-mg', productId: mgA })).status).toBe(403);
    const rule = await prismaBase.metaCampaignMapping.findFirstOrThrow({ where: { tenantId: tA, kind: 'prefix' } });
    expect((await request(app).delete(`/api/marketing/mappings/rules/${rule.id}`).set(h)).status).toBe(403);
  });
});
