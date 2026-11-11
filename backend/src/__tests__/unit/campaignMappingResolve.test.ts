import { describe, it, expect } from '@jest/globals';
import { resolveWith, campaignKey, PrefixRule, CampaignPick } from '../../services/marketing/campaignMappingService';

const mg = { id: 1, name: 'Magic Groove', isActive: true };
const mgTest = { id: 2, name: 'MG Test Kit', isActive: true };
const old = { id: 3, name: 'Pile Combo', isActive: false };
const rules: PrefixRule[] = [
  { prefix: 'MG_', product: mg },
  { prefix: 'MG_T', product: mgTest },
  { prefix: 'PC_', product: old },
];
const camp = (campaignName: string, campaignId = 'c1', adAccountId = 1) => ({ adAccountId, campaignId, campaignName });
const one = (c: ReturnType<typeof camp>, r = rules, picks: CampaignPick[] = []) => resolveWith([c], r, picks).get(campaignKey(c.adAccountId, c.campaignId));

describe('resolveWith', () => {
  it('maps MG_ManualCBO | 16032026 to Magic Groove by prefix', () => {
    expect(one(camp('MG_ManualCBO | 16032026'))).toEqual({ productId: 1, productName: 'Magic Groove', via: 'prefix', archived: false });
  });

  it('a one-off pick beats a prefix rule', () => {
    const c = camp('MG_ManualCBO');
    const pick: CampaignPick = { adAccountId: 1, campaignId: 'c1', product: mgTest };
    expect(one(c, rules, [pick])).toMatchObject({ productId: 2, via: 'campaign' });
  });

  it('a pick is per ad account and campaign id', () => {
    const pick: CampaignPick = { adAccountId: 2, campaignId: 'c1', product: mgTest };
    expect(one(camp('MG_X'), rules, [pick])).toMatchObject({ productId: 1, via: 'prefix' });
  });

  it('the longest prefix wins (MG_ vs MG_T)', () => {
    expect(one(camp('MG_Test batch'))).toMatchObject({ productId: 2 });
    expect(one(camp('MG_Other'))).toMatchObject({ productId: 1 });
  });

  it('matches case-insensitively after trimming the name', () => {
    expect(one(camp('  mg_lowercase  '))).toMatchObject({ productId: 1 });
  });

  it('a prefix must start the name, not sit inside it', () => {
    expect(one(camp('New MG_ campaign'))).toBeNull();
  });

  it('no match gives null', () => {
    expect(one(camp('Retargeting 2026'))).toBeNull();
    expect(one(camp('MG_X'), [])).toBeNull();
  });

  it('flags an archived product but still maps to it', () => {
    expect(one(camp('PC_Combo'))).toEqual({ productId: 3, productName: 'Pile Combo', via: 'prefix', archived: true });
    const pick: CampaignPick = { adAccountId: 1, campaignId: 'c1', product: old };
    expect(one(camp('Anything'), rules, [pick])).toMatchObject({ via: 'campaign', archived: true });
  });
});
